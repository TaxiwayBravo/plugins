using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Windows.Media.Control;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private const int MediaManagerTimeoutMs = 4000;
    private const int MediaPropertiesTimeoutMs = 3500;

    public static async Task Main()
    {
        Console.InputEncoding = System.Text.Encoding.UTF8;
        Console.OutputEncoding = System.Text.Encoding.UTF8;

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
            "toggle" => await RunSessionControl(s => s.TryTogglePlayPauseAsync().AsTask()),
            "next" => await RunSessionControl(s => s.TrySkipNextAsync().AsTask()),
            "previous" => await RunSessionControl(s => s.TrySkipPreviousAsync().AsTask()),
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

        // TIDAL has changed its Windows identity in the past. If TIDAL is running and
        // Windows exposes exactly one media session, that single session is the safest fallback.
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

    private static async Task<Response> GetState()
    {
        var lookup = await FindTidalSession();
        var session = lookup.Session;

        if (session is null)
            return new Response(true, State: new State(false, Error: lookup.Error));

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

    private static async Task<Response> GetDiagnostic()
    {
        try
        {
            var lookup = await FindTidalSession();
            var details = new
            {
                tidalProcessRunning = IsTidalRunning(),
                matchedSession = lookup.Session?.SourceAppUserModelId,
                sessions = lookup.Sources,
                error = lookup.Error
            };

            return new Response(true, Diagnostic: details);
        }
        catch (Exception ex)
        {
            return new Response(false, Error: ex.Message);
        }
    }

    private static async Task<Response> RunSessionControl(
        Func<GlobalSystemMediaTransportControlsSession, Task<bool>> action)
    {
        var lookup = await FindTidalSession();
        var session = lookup.Session;
        if (session is null)
            return new Response(false, Error: lookup.Error ?? "TIDAL media session not found");

        var task = action(session);
        var finished = await Task.WhenAny(task, Task.Delay(2500));

        if (finished != task)
            return new Response(false, Error: "TIDAL control timed out");

        return new Response(await task);
    }

    private static async Task<Response> Seek(long positionMs)
    {
        var lookup = await FindTidalSession();
        var session = lookup.Session;
        if (session is null)
            return new Response(false, Error: lookup.Error ?? "TIDAL media session not found");

        var ticks = Math.Max(0, positionMs) * TimeSpan.TicksPerMillisecond;
        var task = session.TryChangePlaybackPositionAsync(ticks).AsTask();
        var finished = await Task.WhenAny(task, Task.Delay(2500));

        if (finished != task)
            return new Response(false, Error: "Seek timed out");

        return new Response(await task);
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
            return new Response(false, Error: "TIDAL window not found");

        var previous = GetForegroundWindow();

        try
        {
            SetForegroundWindow(tidal.MainWindowHandle);
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

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

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
