using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Windows.Media.Control;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private const int MediaManagerTimeoutMs = 4000;
    private const int MediaPropertiesTimeoutMs = 3500;
    private static DateTimeOffset MediaManagerBackoffUntil = DateTimeOffset.MinValue;

    private const uint WM_APPCOMMAND = 0x0319;
    private const int APPCOMMAND_MEDIA_NEXTTRACK = 11;
    private const int APPCOMMAND_MEDIA_PREVIOUSTRACK = 12;
    private const int APPCOMMAND_MEDIA_PLAY_PAUSE = 14;
    private const uint SMTO_ABORTIFHUNG = 0x0002;

    private const ushort VK_MEDIA_NEXT_TRACK = 0xB0;
    private const ushort VK_MEDIA_PREV_TRACK = 0xB1;
    private const ushort VK_MEDIA_PLAY_PAUSE = 0xB3;

    public static async Task Main()
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;

        while (true)
        {
            var line = await Console.In.ReadLineAsync();
            if (line is null)
                break;

            if (string.IsNullOrWhiteSpace(line))
                continue;

            Response response;

            try
            {
                var request = JsonSerializer.Deserialize<Request>(line, JsonOptions)
                              ?? throw new InvalidOperationException("Invalid request");

                response = await Handle(request);
            }
            catch (Exception ex)
            {
                response = new Response(false, Error: ex.Message);
            }

            Console.WriteLine(JsonSerializer.Serialize(response, JsonOptions));
            Console.Out.Flush();
        }
    }

    private static async Task<Response> Handle(Request request)
    {
        return request.Command switch
        {
            "state" => await GetState(),
            "toggle" => await RunSessionControl(
                s => s.TryTogglePlayPauseAsync().AsTask(),
                APPCOMMAND_MEDIA_PLAY_PAUSE,
                VK_MEDIA_PLAY_PAUSE
            ),
            "next" => await RunSessionControl(
                s => s.TrySkipNextAsync().AsTask(),
                APPCOMMAND_MEDIA_NEXTTRACK,
                VK_MEDIA_NEXT_TRACK
            ),
            "previous" => await RunSessionControl(
                s => s.TrySkipPreviousAsync().AsTask(),
                APPCOMMAND_MEDIA_PREVIOUSTRACK,
                VK_MEDIA_PREV_TRACK
            ),
            "seek" => await Seek(request.PositionMs ?? 0),
            "shuffle" => await SendTidalShortcut('S'),
            "repeat" => await SendTidalShortcut('R'),
            "diagnostic" => await GetDiagnostic(),
            _ => new Response(false, Error: $"Unknown command: {request.Command}")
        };
    }

    private static async Task<T> WithTimeout<T>(Task<T> task, int timeoutMs, string operation)
    {
        var finished = await Task.WhenAny(task, Task.Delay(timeoutMs));
        if (finished != task)
            throw new TimeoutException($"{operation} timed out after {timeoutMs / 1000.0:0.#} seconds");

        return await task;
    }

    private static bool IsTidalRunning()
    {
        return Process.GetProcesses().Any(process =>
        {
            try
            {
                return process.ProcessName.Contains("TIDAL", StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        });
    }

    private static async Task<SessionLookup> FindTidalSession()
    {
        if (DateTimeOffset.UtcNow < MediaManagerBackoffUntil)
        {
            var remaining = Math.Max(1, (int)Math.Ceiling((MediaManagerBackoffUntil - DateTimeOffset.UtcNow).TotalSeconds));
            throw new TimeoutException($"Windows media session manager is in fallback cooldown for another {remaining} seconds");
        }

        try
        {
            var manager = await WithTimeout(
                GlobalSystemMediaTransportControlsSessionManager.RequestAsync().AsTask(),
                MediaManagerTimeoutMs,
                "Windows media session manager"
            );

            var sessions = manager.GetSessions().ToList();
            var direct = sessions.FirstOrDefault(session =>
                session.SourceAppUserModelId.Contains("TIDAL", StringComparison.OrdinalIgnoreCase)
            );

            if (direct is not null)
                return new SessionLookup(direct, null, sessions.Select(s => s.SourceAppUserModelId).ToArray());

            if (!IsTidalRunning())
                return new SessionLookup(null, null, sessions.Select(s => s.SourceAppUserModelId).ToArray());

            if (sessions.Count == 1)
                return new SessionLookup(sessions[0], null, sessions.Select(s => s.SourceAppUserModelId).ToArray());

            var sources = sessions.Count == 0
                ? "none"
                : string.Join(", ", sessions.Select(s => s.SourceAppUserModelId));

            return new SessionLookup(
                null,
                $"TIDAL is running, but Windows did not expose an identifiable TIDAL media session. Sessions: {sources}",
                sessions.Select(s => s.SourceAppUserModelId).ToArray()
            );
        }
        catch (TimeoutException)
        {
            MediaManagerBackoffUntil = DateTimeOffset.UtcNow.AddSeconds(60);
            throw;
        }
    }

    private static async Task<Response> GetState()
    {
        if (!IsTidalRunning())
            return new Response(true, State: new State(false));

        try
        {
            var lookup = await FindTidalSession();
            var session = lookup.Session;

            if (session is null)
                return GetFallbackState(lookup.Error ?? "Windows did not expose a TIDAL media session");

            try
            {
                var media = await WithTimeout(
                    session.TryGetMediaPropertiesAsync().AsTask(),
                    MediaPropertiesTimeoutMs,
                    "TIDAL media properties"
                );

                var playback = session.GetPlaybackInfo();
                var timeline = session.GetTimelineProperties();
                var controls = playback.Controls;

                var duration = timeline.EndTime - timeline.StartTime;
                var rawPosition = timeline.Position - timeline.StartTime;

                var durationMs = Math.Max(0, duration.TotalMilliseconds);
                var positionMs = Math.Max(0, rawPosition.TotalMilliseconds);

                if (playback.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
                {
                    var elapsed = DateTimeOffset.UtcNow - timeline.LastUpdatedTime.ToUniversalTime();

                    if (elapsed.TotalMilliseconds > 0 && elapsed.TotalDays < 1)
                        positionMs += elapsed.TotalMilliseconds;
                }

                if (durationMs > 0)
                    positionMs = Math.Min(positionMs, durationMs);

                var state = new State(
                    Available: true,
                    Source: session.SourceAppUserModelId,
                    Title: media.Title,
                    Artist: media.Artist,
                    Album: media.AlbumTitle,
                    Playing: playback.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing,
                    PositionMs: (long)Math.Round(positionMs),
                    DurationMs: (long)Math.Round(durationMs),
                    PositionCapturedAtMs: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    CanPlayPause: controls.IsPlayEnabled || controls.IsPauseEnabled,
                    CanNext: controls.IsNextEnabled,
                    CanPrevious: controls.IsPreviousEnabled,
                    CanSeek: controls.IsPlaybackPositionEnabled,
                    CanShuffle: controls.IsShuffleEnabled,
                    CanRepeat: controls.IsRepeatEnabled,
                    ShuffleActive: playback.IsShuffleActive ?? false,
                    RepeatMode: playback.AutoRepeatMode?.ToString() ?? "None"
                );

                return new Response(true, State: state);
            }
            catch (TimeoutException ex)
            {
                MediaManagerBackoffUntil = DateTimeOffset.UtcNow.AddSeconds(60);
                return GetFallbackState(ex.Message);
            }
        }
        catch (TimeoutException ex)
        {
            return GetFallbackState(ex.Message);
        }
        catch (Exception ex)
        {
            return GetFallbackState($"Windows media API failed: {ex.Message}");
        }
    }

    private static Response GetFallbackState(string reason)
    {
        var info = ReadTidalWindowMetadata();

        if (!info.Running)
            return new Response(true, State: new State(false));

        if (string.IsNullOrWhiteSpace(info.Title))
        {
            return new Response(
                true,
                State: new State(
                    false,
                    Source: "TIDAL Win32 fallback",
                    Error: $"{reason}. TIDAL is running, but its window does not currently expose track metadata."
                )
            );
        }

        return new Response(
            true,
            State: new State(
                Available: true,
                Source: "TIDAL Win32 fallback",
                Title: info.Title,
                Artist: info.Artist,
                Playing: true,
                PositionMs: 0,
                DurationMs: 0,
                PositionCapturedAtMs: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                CanPlayPause: true,
                CanNext: true,
                CanPrevious: true,
                CanSeek: false,
                CanShuffle: true,
                CanRepeat: true,
                ShuffleActive: false,
                RepeatMode: "None",
                Error: reason
            )
        );
    }

    private static TidalWindowMetadata ReadTidalWindowMetadata()
    {
        var processes = Process.GetProcesses()
            .Where(process =>
            {
                try
                {
                    return process.ProcessName.Contains("TIDAL", StringComparison.OrdinalIgnoreCase);
                }
                catch
                {
                    return false;
                }
            })
            .ToArray();

        if (processes.Length == 0)
            return new TidalWindowMetadata(false, null, null, null, IntPtr.Zero);

        var pids = processes.Select(p => (uint)p.Id).ToHashSet();
        var candidates = new List<WindowCandidate>();

        EnumWindows((hWnd, _) =>
        {
            try
            {
                GetWindowThreadProcessId(hWnd, out var pid);
                if (!pids.Contains(pid))
                    return true;

                var length = GetWindowTextLengthW(hWnd);
                if (length <= 0)
                    return true;

                var buffer = new StringBuilder(length + 1);
                GetWindowTextW(hWnd, buffer, buffer.Capacity);

                var title = buffer.ToString().Trim();
                if (string.IsNullOrWhiteSpace(title) || IsTechnicalTidalWindowTitle(title))
                    return true;

                var score = title.Contains(" - ", StringComparison.Ordinal) ? 1000 : 0;
                if (IsWindowVisible(hWnd))
                    score += 100;

                score += Math.Min(title.Length, 200);
                candidates.Add(new WindowCandidate(hWnd, title, score));
            }
            catch
            {
            }

            return true;
        }, IntPtr.Zero);

        var best = candidates
            .OrderByDescending(candidate => candidate.Score)
            .FirstOrDefault();

        if (best is null)
        {
            foreach (var process in processes)
            {
                try
                {
                    var title = process.MainWindowTitle?.Trim();
                    if (!string.IsNullOrWhiteSpace(title) && !IsTechnicalTidalWindowTitle(title))
                    {
                        best = new WindowCandidate(process.MainWindowHandle, title, title.Length);
                        break;
                    }
                }
                catch
                {
                }
            }
        }

        if (best is null)
            return new TidalWindowMetadata(true, null, null, null, IntPtr.Zero);

        var rawTitle = best.Title;
        var split = rawTitle.LastIndexOf(" - ", StringComparison.Ordinal);

        if (split > 0 && split < rawTitle.Length - 3)
        {
            var title = rawTitle[..split].Trim();
            var artist = rawTitle[(split + 3)..].Trim();

            if (!string.IsNullOrWhiteSpace(title) && !string.IsNullOrWhiteSpace(artist))
                return new TidalWindowMetadata(true, title, artist, rawTitle, best.Handle);
        }

        return new TidalWindowMetadata(true, rawTitle, null, rawTitle, best.Handle);
    }

    private static bool IsTechnicalTidalWindowTitle(string title)
    {
        if (title.Equals("TIDAL", StringComparison.OrdinalIgnoreCase))
            return true;

        return title.StartsWith("MSCTFIME UI", StringComparison.OrdinalIgnoreCase)
               || title.StartsWith("Default IME", StringComparison.OrdinalIgnoreCase)
               || title.StartsWith("MediaPlayer SMTC window", StringComparison.OrdinalIgnoreCase)
               || title.StartsWith("Program Manager", StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<Response> GetDiagnostic()
    {
        var fallback = ReadTidalWindowMetadata();

        try
        {
            var lookup = await FindTidalSession();

            var details = new
            {
                tidalProcessRunning = IsTidalRunning(),
                matchedSession = lookup.Session?.SourceAppUserModelId,
                sessions = lookup.Sources,
                windowsFallback = new
                {
                    title = fallback.Title,
                    artist = fallback.Artist,
                    rawWindowTitle = fallback.RawTitle,
                    hasWindowHandle = fallback.Handle != IntPtr.Zero
                },
                mediaManagerBackoffUntil = MediaManagerBackoffUntil == DateTimeOffset.MinValue
                    ? null
                    : MediaManagerBackoffUntil.ToString("O"),
                error = lookup.Error
            };

            return new Response(true, Diagnostic: details);
        }
        catch (Exception ex)
        {
            var details = new
            {
                tidalProcessRunning = fallback.Running,
                windowsFallback = new
                {
                    title = fallback.Title,
                    artist = fallback.Artist,
                    rawWindowTitle = fallback.RawTitle,
                    hasWindowHandle = fallback.Handle != IntPtr.Zero
                },
                mediaManagerBackoffUntil = MediaManagerBackoffUntil == DateTimeOffset.MinValue
                    ? null
                    : MediaManagerBackoffUntil.ToString("O"),
                error = ex.Message
            };

            return new Response(true, Diagnostic: details);
        }
    }

    private static async Task<Response> RunSessionControl(
        Func<GlobalSystemMediaTransportControlsSession, Task<bool>> action,
        int fallbackAppCommand,
        ushort fallbackVirtualKey
    )
    {
        try
        {
            var lookup = await FindTidalSession();
            var session = lookup.Session;

            if (session is not null)
            {
                var task = action(session);
                var finished = await Task.WhenAny(task, Task.Delay(2500));

                if (finished == task)
                {
                    var ok = await task;
                    if (ok)
                        return new Response(true);
                }
            }
        }
        catch
        {
        }

        return SendFallbackMediaCommand(fallbackAppCommand, fallbackVirtualKey);
    }

    private static Response SendFallbackMediaCommand(int appCommand, ushort virtualKey)
    {
        var info = ReadTidalWindowMetadata();

        if (!info.Running)
            return new Response(false, Error: "TIDAL is not running");

        if (info.Handle != IntPtr.Zero)
        {
            var result = SendMessageTimeout(
                info.Handle,
                WM_APPCOMMAND,
                info.Handle,
                (IntPtr)(appCommand << 16),
                SMTO_ABORTIFHUNG,
                700,
                out _
            );

            if (result != IntPtr.Zero)
                return new Response(true);
        }

        try
        {
            SendMediaKey(virtualKey);
            return new Response(true);
        }
        catch (Exception ex)
        {
            return new Response(false, Error: $"Direct TIDAL media control failed: {ex.Message}");
        }
    }

    private static async Task<Response> Seek(long positionMs)
    {
        try
        {
            var lookup = await FindTidalSession();
            var session = lookup.Session;

            if (session is null)
                return new Response(false, Error: "Seek is unavailable while TIDAL is using direct fallback mode");

            var ticks = Math.Max(0, positionMs) * TimeSpan.TicksPerMillisecond;
            var task = session.TryChangePlaybackPositionAsync(ticks).AsTask();
            var finished = await Task.WhenAny(task, Task.Delay(2500));

            if (finished != task)
                return new Response(false, Error: "Seek timed out");

            return new Response(await task);
        }
        catch
        {
            return new Response(false, Error: "Seek is unavailable while TIDAL is using direct fallback mode");
        }
    }

    private static async Task<Response> SendTidalShortcut(char key)
    {
        var tidal = Process.GetProcesses()
            .FirstOrDefault(process =>
            {
                try
                {
                    return process.ProcessName.Equals("TIDAL", StringComparison.OrdinalIgnoreCase)
                           && process.MainWindowHandle != IntPtr.Zero;
                }
                catch
                {
                    return false;
                }
            });

        if (tidal is null)
        {
            var info = ReadTidalWindowMetadata();
            if (!info.Running || info.Handle == IntPtr.Zero)
                return new Response(false, Error: "TIDAL window not found");

            return await SendShortcutToWindow(info.Handle, key);
        }

        return await SendShortcutToWindow(tidal.MainWindowHandle, key);
    }

    private static async Task<Response> SendShortcutToWindow(IntPtr handle, char key)
    {
        var previous = GetForegroundWindow();

        try
        {
            SetForegroundWindow(handle);
            await Task.Delay(45);

            SendCtrlKey(key);
            await Task.Delay(45);

            if (previous != IntPtr.Zero)
                SetForegroundWindow(previous);

            return new Response(true);
        }
        catch (Exception ex)
        {
            if (previous != IntPtr.Zero)
                SetForegroundWindow(previous);

            return new Response(false, Error: ex.Message);
        }
    }

    private static void SendCtrlKey(char key)
    {
        ushort vk = (ushort)char.ToUpperInvariant(key);

        var inputs = new[]
        {
            KeyboardInput(VK_CONTROL, false),
            KeyboardInput(vk, false),
            KeyboardInput(vk, true),
            KeyboardInput(VK_CONTROL, true)
        };

        var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());

        if (sent != inputs.Length)
            throw new InvalidOperationException("Windows could not send the TIDAL shortcut");
    }

    private static void SendMediaKey(ushort virtualKey)
    {
        var inputs = new[]
        {
            KeyboardInput(virtualKey, false),
            KeyboardInput(virtualKey, true)
        };

        var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());

        if (sent != inputs.Length)
            throw new InvalidOperationException("Windows could not send the media key");
    }

    private static INPUT KeyboardInput(ushort vk, bool keyUp) => new()
    {
        type = INPUT_KEYBOARD,
        U = new InputUnion
        {
            ki = new KEYBDINPUT
            {
                wVk = vk,
                dwFlags = keyUp ? KEYEVENTF_KEYUP : 0
            }
        }
    };

    private const int INPUT_KEYBOARD = 1;
    private const ushort VK_CONTROL = 0x11;
    private const uint KEYEVENTF_KEYUP = 0x0002;

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLengthW(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(
        IntPtr hWnd,
        uint msg,
        IntPtr wParam,
        IntPtr lParam,
        uint fuFlags,
        uint uTimeout,
        out IntPtr lpdwResult
    );

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public int type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)]
        public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    private sealed record Request(string Command, long? PositionMs = null);

    private sealed record SessionLookup(
        GlobalSystemMediaTransportControlsSession? Session,
        string? Error,
        string[] Sources
    );

    private sealed record WindowCandidate(
        IntPtr Handle,
        string Title,
        int Score
    );

    private sealed record TidalWindowMetadata(
        bool Running,
        string? Title,
        string? Artist,
        string? RawTitle,
        IntPtr Handle
    );

    private sealed record Response(
        bool Ok,
        State? State = null,
        string? Error = null,
        object? Diagnostic = null
    );

    private sealed record State(
        bool Available,
        string? Source = null,
        string? Title = null,
        string? Artist = null,
        string? Album = null,
        bool Playing = false,
        long PositionMs = 0,
        long DurationMs = 0,
        long PositionCapturedAtMs = 0,
        bool CanPlayPause = false,
        bool CanNext = false,
        bool CanPrevious = false,
        bool CanSeek = false,
        bool CanShuffle = false,
        bool CanRepeat = false,
        bool ShuffleActive = false,
        string RepeatMode = "None",
        string? Error = null
    );
}
