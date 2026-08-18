/*
 * TidalControls v1.2 native bridge
 * NO POWERSHELL.
 * Communicates with a local C# Windows helper over JSON lines.
 */

import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { existsSync } from "fs";
import { get as httpsGet } from "https";
import { join } from "path";
import type { IpcMainInvokeEvent } from "electron";

const HELPER_PATH = join(process.env.APPDATA ?? "", "Vencord", "TidalControls", "TidalControlsHelper.exe");

interface HelperResponse<T = unknown> {
    ok: boolean;
    state?: T;
    error?: string;
}

interface Pending {
    resolve(value: HelperResponse): void;
    reject(reason: Error): void;
    timer: ReturnType<typeof setTimeout>;
}

let helper: ChildProcessWithoutNullStreams | null = null;
let stdoutBuffer = "";
const pending: Pending[] = [];

function ensureHelper() {
    if (helper && !helper.killed)
        return helper;

    if (!existsSync(HELPER_PATH))
        throw new Error(`TidalControlsHelper.exe is missing. Run build-helper.cmd first. Expected: ${HELPER_PATH}`);

    helper = spawn(HELPER_PATH, [], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
    });

    stdoutBuffer = "";

    helper.stdout.setEncoding("utf8");
    helper.stdout.on("data", chunk => {
        stdoutBuffer += chunk;

        while (true) {
            const newline = stdoutBuffer.indexOf("\n");
            if (newline < 0)
                break;

            const line = stdoutBuffer.slice(0, newline).trim();
            stdoutBuffer = stdoutBuffer.slice(newline + 1);

            if (!line)
                continue;

            const request = pending.shift();
            if (!request)
                continue;

            clearTimeout(request.timer);

            try {
                request.resolve(JSON.parse(line));
            } catch {
                request.reject(new Error(`Invalid helper response: ${line.slice(0, 500)}`));
            }
        }
    });

    let stderr = "";
    helper.stderr.setEncoding("utf8");
    helper.stderr.on("data", chunk => stderr += chunk);

    helper.on("exit", code => {
        const err = new Error(`TidalControls helper exited (${code ?? "unknown"}). ${stderr}`.trim());

        while (pending.length) {
            const p = pending.shift()!;
            clearTimeout(p.timer);
            p.reject(err);
        }

        helper = null;
    });

    helper.on("error", err => {
        while (pending.length) {
            const p = pending.shift()!;
            clearTimeout(p.timer);
            p.reject(err);
        }

        helper = null;
    });

    return helper;
}

function helperRequest<T>(command: string, extra: Record<string, unknown> = {}, timeoutMs = 5000): Promise<HelperResponse<T>> {
    return new Promise((resolve, reject) => {
        let child: ChildProcessWithoutNullStreams;

        try {
            child = ensureHelper();
        } catch (e) {
            reject(e);
            return;
        }

        const timer = setTimeout(() => {
            const idx = pending.findIndex(p => p.timer === timer);
            if (idx >= 0)
                pending.splice(idx, 1);

            reject(new Error(`${command} helper request timed out`));
        }, timeoutMs);

        pending.push({
            resolve: resolve as (value: HelperResponse) => void,
            reject,
            timer
        });

        child.stdin.write(JSON.stringify({ command, ...extra }) + "\n");
    });
}

interface ItunesTrack {
    artistName?: string;
    trackName?: string;
    artworkUrl100?: string;
}

interface ItunesSearchResponse {
    results?: ItunesTrack[];
}

const artworkCache = new Map<string, string | null>();

function normalise(value = "") {
    return value
        .toLowerCase()
        .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
        .replace(/feat\.?|ft\.?/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function getJson<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const req = httpsGet(url, {
            headers: {
                "User-Agent": "Vencord-TidalControls/1.2",
                "Accept": "application/json"
            }
        }, response => {
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Artwork search returned HTTP ${response.statusCode}`));
                return;
            }

            let body = "";
            response.setEncoding("utf8");
            response.on("data", chunk => body += chunk);
            response.on("end", () => {
                try {
                    resolve(JSON.parse(body) as T);
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.setTimeout(5000, () => req.destroy(new Error("Artwork search timed out")));
        req.on("error", reject);
    });
}

function getBinary(url: string): Promise<{ data: Buffer; contentType: string; }> {
    return new Promise((resolve, reject) => {
        const req = httpsGet(url, {
            headers: {
                "User-Agent": "Vencord-TidalControls/1.2",
                "Accept": "image/*,*/*;q=0.8"
            }
        }, response => {
            if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume();
                getBinary(new URL(response.headers.location, url).toString()).then(resolve, reject);
                return;
            }

            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Artwork download returned HTTP ${response.statusCode}`));
                return;
            }

            const chunks: Buffer[] = [];
            response.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            response.on("end", () => resolve({
                data: Buffer.concat(chunks),
                contentType: String(response.headers["content-type"] || "image/jpeg").split(";")[0]
            }));
        });

        req.setTimeout(5000, () => req.destroy(new Error("Artwork download timed out")));
        req.on("error", reject);
    });
}

async function findFallbackArtwork(title?: string, artist?: string): Promise<string | null> {
    if (!title)
        return null;

    const key = `${normalise(title)}|${normalise(artist)}`;
    if (artworkCache.has(key))
        return artworkCache.get(key) ?? null;

    try {
        const term = encodeURIComponent(`${title} ${artist ?? ""}`.trim());
        const searchResult = await getJson<ItunesSearchResponse>(
            `https://itunes.apple.com/search?term=${term}&entity=song&limit=8&country=GB`
        );

        const wantedTitle = normalise(title);
        const wantedArtist = normalise(artist);

        const results = searchResult.results ?? [];
        const exact = results.find(track =>
            normalise(track.trackName) === wantedTitle &&
            (!wantedArtist || normalise(track.artistName).includes(wantedArtist))
        );

        const chosen = exact ?? results.find(track =>
            normalise(track.trackName).includes(wantedTitle) ||
            wantedTitle.includes(normalise(track.trackName))
        ) ?? results[0];

        let url = chosen?.artworkUrl100 ?? null;
        if (!url) {
            artworkCache.set(key, null);
            return null;
        }

        url = url.replace(/100x100(?:bb)?\.(jpg|png)$/i, "600x600bb.$1");

        const { data: imageBytes, contentType } = await getBinary(url);
        const result = `data:${contentType};base64,${imageBytes.toString("base64")}`;
        artworkCache.set(key, result);
        return result;
    } catch {
        artworkCache.set(key, null);
        return null;
    }
}

export interface NativeTidalState {
    available: boolean;
    source?: string;
    title?: string;
    artist?: string;
    album?: string;
    artwork?: string;
    playing?: boolean;
    positionMs?: number;
    durationMs?: number;
    positionCapturedAtMs?: number;
    canPlayPause?: boolean;
    canNext?: boolean;
    canPrevious?: boolean;
    canSeek?: boolean;
    canShuffle?: boolean;
    canRepeat?: boolean;
    shuffleActive?: boolean;
    repeatMode?: "None" | "Track" | "List";
    error?: string;
}

export async function getState(_: IpcMainInvokeEvent): Promise<NativeTidalState> {
    const response = await helperRequest<NativeTidalState>("state");

    if (!response.ok)
        throw new Error(response.error || "TIDAL helper state request failed");

    const state = response.state ?? { available: false };

    if (state.available && !state.artwork)
        state.artwork = await findFallbackArtwork(state.title, state.artist) ?? undefined;

    return state;
}

export async function control(
    _: IpcMainInvokeEvent,
    action: "toggle" | "next" | "previous"
): Promise<{ ok: boolean; }> {
    const response = await helperRequest(action, {}, 3500);
    return { ok: !!response.ok };
}

export async function seek(
    _: IpcMainInvokeEvent,
    positionMs: number
): Promise<{ ok: boolean; }> {
    const response = await helperRequest("seek", { positionMs: Math.max(0, Math.round(positionMs)) }, 3500);
    return { ok: !!response.ok };
}

export async function tidalShortcut(
    _: IpcMainInvokeEvent,
    action: "shuffle" | "repeat"
): Promise<{ ok: boolean; }> {
    const response = await helperRequest(action, {}, 2500);
    return { ok: !!response.ok };
}
