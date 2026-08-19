/*
 * TidalControls - TaxiwayBravo Vencord plugin
 * Windows desktop only
 * v1.2.3: helper timeout recovery + visible diagnostics
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import definePlugin, { PluginNative } from "@utils/types";

const Native = VencordNative.pluginHelpers.TidalControls as PluginNative<typeof import("./native")>;

interface TidalState {
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

let observer: MutationObserver | null = null;
let pollTimer: number | null = null;
let renderTimer: number | null = null;
let mountTimer: number | null = null;
let host: HTMLDivElement | null = null;
let currentState: TidalState = { available: false };
let busy = false;
let refreshing = false;
let localShuffle: boolean | null = null;
let localRepeat: "None" | "List" | "Track" | null = null;

function escapeHtml(value?: string) {
    return (value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function fmt(ms = 0) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function findUserSettingsButton(): HTMLElement | null {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("button,[role='button']"));

    return candidates.find(element => {
        const aria = (element.getAttribute("aria-label") ?? "").toLowerCase();
        const title = (element.getAttribute("title") ?? "").toLowerCase();
        return aria.includes("user settings") || title.includes("user settings");
    }) ?? null;
}

function findAccountPanel(settings: HTMLElement): HTMLElement | null {
    let node: HTMLElement | null = settings;

    for (let i = 0; node && i < 9; i++, node = node.parentElement) {
        const rect = node.getBoundingClientRect();
        const nearBottom = rect.bottom >= window.innerHeight - 24;
        const leftSidebar = rect.left <= 90;
        const sidebarWidth = rect.width >= 170 && rect.width <= 380;
        const accountHeight = rect.height >= 38 && rect.height <= 100;

        if (nearBottom && leftSidebar && sidebarWidth && accountHeight)
            return node;
    }

    return null;
}

function findPanelStack(): HTMLElement | null {
    const settings = findUserSettingsButton();
    if (!settings)
        return null;

    const account = findAccountPanel(settings);
    if (!account?.parentElement)
        return null;

    let stack: HTMLElement = account.parentElement;
    const parent = stack.parentElement;

    if (parent) {
        const stackRect = stack.getBoundingClientRect();
        const parentRect = parent.getBoundingClientRect();
        const sameWidth = Math.abs(stackRect.width - parentRect.width) < 10;
        const sameLeft = Math.abs(stackRect.left - parentRect.left) < 10;
        const parentBottom = parentRect.bottom >= window.innerHeight - 24;
        const parentReasonable = parentRect.height <= 320;

        if (sameWidth && sameLeft && parentBottom && parentReasonable && parent.children.length <= 10)
            stack = parent;
    }

    return stack;
}

function ensureHost() {
    if (host?.isConnected)
        return true;

    const stack = findPanelStack();
    if (!stack)
        return false;

    host = document.createElement("div");
    host.id = "vc-tidal-controls-host";
    host.dataset.vencordPlugin = "TidalControls";
    stack.insertBefore(host, stack.firstElementChild);
    render();
    return true;
}

function artworkHtml(state: TidalState) {
    if (state.artwork) {
        return `
            <span class="vc-tidal-art">
                <img src="${escapeHtml(state.artwork)}" alt="" draggable="false">
            </span>
        `;
    }

    return `
        <span class="vc-tidal-art vc-tidal-art-fallback" aria-hidden="true">
            <svg viewBox="0 0 48 48">
                <path fill="currentColor" d="M12 8 4 16l8 8 8-8-8-8Zm24 0-8 8 8 8 8-8-8-8ZM24 8l-8 8 8 8 8-8-8-8ZM24 24l-8 8 8 8 8-8-8-8Z"/>
            </svg>
        </span>
    `;
}

function renderDiagnostic(error: string) {
    if (!host)
        return;

    host.innerHTML = `
        <div class="vc-tidal-player vc-tidal-diagnostic">
            <div class="vc-tidal-track">
                ${artworkHtml({ available: false })}
                <span class="vc-tidal-text">
                    <span class="vc-tidal-title">TIDAL connection problem</span>
                    <span class="vc-tidal-artist vc-tidal-error-text">${escapeHtml(error)}</span>
                </span>
            </div>
            <button class="vc-tidal-refresh" data-action="refresh" title="Retry TIDAL connection">
                <svg viewBox="0 0 24 24"><path fill="currentColor" d="M18.4 5.6A8 8 0 1 0 20 14h-2a6 6 0 1 1-1-5.3L14 12h8V4l-3.6 3.6Z"/></svg>
            </button>
        </div>
    `;

    host.querySelector<HTMLElement>("[data-action='refresh']")?.addEventListener("click", () => void refresh());
}

function render() {
    if (!host?.isConnected)
        return;

    const state = currentState;
    const connected = !!state.available;
    const hasActiveTrack = connected && !!(state.title || state.artist || (state.durationMs && state.durationMs > 0));
    const hasError = !!state.error;

    host.style.display = hasActiveTrack || hasError ? "" : "none";

    if (!hasActiveTrack) {
        if (hasError)
            renderDiagnostic(state.error!);
        else
            host.innerHTML = "";
        return;
    }

    const duration = Math.max(0, state.durationMs ?? 0);
    let position = Math.max(0, state.positionMs ?? 0);

    if (state.playing && state.positionCapturedAtMs)
        position += Math.max(0, Date.now() - state.positionCapturedAtMs);

    position = Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, position));

    const shuffleActive = localShuffle ?? state.shuffleActive ?? false;
    const repeatMode = localRepeat ?? state.repeatMode ?? "None";

    host.innerHTML = `
        <div class="vc-tidal-player">
            <div class="vc-tidal-track">
                ${artworkHtml(state)}
                <span class="vc-tidal-text">
                    <span class="vc-tidal-title">${escapeHtml(state.title || "TIDAL")}</span>
                    <span class="vc-tidal-artist">${escapeHtml(state.artist || state.album || "TIDAL")}</span>
                </span>
            </div>

            <div class="vc-tidal-controls">
                <button class="vc-tidal-button ${shuffleActive ? "vc-tidal-active" : ""}" data-action="shuffle" title="${shuffleActive ? "Disable shuffle" : "Enable shuffle"}" ${busy ? "disabled" : ""}>
                    <svg viewBox="0 0 24 24"><path fill="currentColor" d="M16.5 3H21v4.5h-2V6.4l-3.7 3.7-1.4-1.4L17.6 5H16.5V3ZM3 6h3.4c1.8 0 3.5.7 4.7 2l5.8 7.2c.8 1 1.8 1.6 3.1 1.6H21V15h-1c-.7 0-1.3-.3-1.8-.9l-5.8-7.2C10.8 5 8.7 4 6.4 4H3v2Zm0 12h3.4c2.3 0 4.4-1 5.9-2.9l1-1.2-1.3-1.6-1.2 1.5C9.7 15.2 8.1 16 6.4 16H3v2Zm13.5 3H21v-4.5h-2v1.1l-2.1-2.1-1.3 1.6 2 1.9h-1.1v2Z"/></svg>
                </button>
                <button class="vc-tidal-button" data-action="previous" title="Previous" ${busy || state.canPrevious === false ? "disabled" : ""}>
                    <svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 5h2v14H6V5Zm3.5 7L19 5v14l-9.5-7Z"/></svg>
                </button>
                <button class="vc-tidal-button vc-tidal-primary" data-action="toggle" title="${state.playing ? "Pause" : "Play"}" ${busy || state.canPlayPause === false ? "disabled" : ""}>
                    ${state.playing
                        ? '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z"/></svg>'
                        : '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7L8 5Z"/></svg>'}
                </button>
                <button class="vc-tidal-button" data-action="next" title="Next" ${busy || state.canNext === false ? "disabled" : ""}>
                    <svg viewBox="0 0 24 24"><path fill="currentColor" d="M16 5h2v14h-2V5ZM5 5l9.5 7L5 19V5Z"/></svg>
                </button>
                <button class="vc-tidal-button ${repeatMode !== "None" ? "vc-tidal-active" : ""}" data-action="repeat" title="Repeat: ${escapeHtml(repeatMode)}" ${busy ? "disabled" : ""}>
                    <svg viewBox="0 0 24 24"><path fill="currentColor" d="M17 2l4 4-4 4V7H7a3 3 0 0 0-3 3v1H2v-1a5 5 0 0 1 5-5h10V2ZM7 22l-4-4 4-4v3h10a3 3 0 0 0 3-3v-1h2v1a5 5 0 0 1-5 5H7v3Z"/></svg>
                    ${repeatMode === "Track" ? '<span class="vc-tidal-repeat-one">1</span>' : ""}
                </button>
            </div>

            ${duration > 0 ? `
                <div class="vc-tidal-progress vc-tidal-progress-always">
                    <span>${fmt(position)}</span>
                    <input data-action="seek" type="range" min="0" max="${duration}" step="250" value="${Math.round(position)}" ${state.canSeek === false ? "disabled" : ""}>
                    <span>${fmt(duration)}</span>
                </div>
            ` : ""}
        </div>
    `;

    host.querySelector<HTMLElement>("[data-action='toggle']")?.addEventListener("click", () => void command("toggle"));
    host.querySelector<HTMLElement>("[data-action='shuffle']")?.addEventListener("click", () => void toggleShuffle());
    host.querySelector<HTMLElement>("[data-action='repeat']")?.addEventListener("click", () => void cycleRepeat());
    host.querySelector<HTMLElement>("[data-action='previous']")?.addEventListener("click", () => void command("previous"));
    host.querySelector<HTMLElement>("[data-action='next']")?.addEventListener("click", () => void command("next"));
    host.querySelector<HTMLInputElement>("[data-action='seek']")?.addEventListener("change", event => {
        void seek(Number((event.currentTarget as HTMLInputElement).value));
    });
}

async function refresh() {
    if (refreshing)
        return;

    refreshing = true;

    try {
        if (!Native?.getState)
            throw new Error("Vencord native bridge unavailable");

        currentState = await Native.getState() ?? {
            available: false,
            error: "Native bridge returned no state"
        };

        if (localShuffle === null && typeof currentState.shuffleActive === "boolean")
            localShuffle = currentState.shuffleActive;

        if (localRepeat === null && currentState.repeatMode)
            localRepeat = currentState.repeatMode;
    } catch (error) {
        currentState = {
            available: false,
            error: error instanceof Error ? error.message : String(error)
        };
    } finally {
        refreshing = false;
        ensureHost();
        render();
    }
}

async function command(action: "toggle" | "next" | "previous") {
    if (busy)
        return;

    busy = true;
    render();

    try {
        const result = await Native.control(action);
        if (result && result.ok === false)
            throw new Error(`${action} is not supported by the current TIDAL media session`);

        await new Promise(resolve => setTimeout(resolve, 150));
        await refresh();
    } catch (error) {
        currentState = { ...currentState, error: error instanceof Error ? error.message : String(error) };
    } finally {
        busy = false;
        render();
    }
}

async function toggleShuffle() {
    if (!currentState.available || busy)
        return;

    const previous = localShuffle ?? currentState.shuffleActive ?? false;
    localShuffle = !previous;
    busy = true;
    render();

    try {
        const result = await Native.tidalShortcut("shuffle");
        if (result && result.ok === false)
            throw new Error("TIDAL shuffle control failed");
        window.setTimeout(() => void refresh(), 350);
    } catch (error) {
        localShuffle = previous;
        currentState = { ...currentState, error: error instanceof Error ? error.message : String(error) };
    } finally {
        busy = false;
        render();
    }
}

async function cycleRepeat() {
    if (!currentState.available || busy)
        return;

    const previous = localRepeat ?? currentState.repeatMode ?? "None";
    localRepeat = previous === "None" ? "List" : previous === "List" ? "Track" : "None";
    busy = true;
    render();

    try {
        const result = await Native.tidalShortcut("repeat");
        if (result && result.ok === false)
            throw new Error("TIDAL repeat control failed");
        window.setTimeout(() => void refresh(), 350);
    } catch (error) {
        localRepeat = previous;
        currentState = { ...currentState, error: error instanceof Error ? error.message : String(error) };
    } finally {
        busy = false;
        render();
    }
}

async function seek(positionMs: number) {
    try {
        const result = await Native.seek(positionMs);
        if (result && result.ok === false)
            throw new Error("TIDAL seek failed");
        await refresh();
    } catch (error) {
        currentState = { ...currentState, error: error instanceof Error ? error.message : String(error) };
        render();
    }
}

function scheduleMount() {
    if (mountTimer !== null)
        return;

    mountTimer = window.setTimeout(() => {
        mountTimer = null;
        ensureHost();
    }, 100);
}

export default definePlugin({
    name: "TidalControls",
    description: "Native Windows TIDAL artwork and playback controls above Discord's voice/account panels.",
    authors: [{ name: "TaxiwayBravo", id: 325723086374567938n }],
    tags: ["Media", "TIDAL"],

    start() {
        console.info("[TidalControls] Starting v1.2.3");
        ensureHost();

        observer = new MutationObserver(() => {
            if (!host?.isConnected)
                scheduleMount();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        pollTimer = window.setInterval(() => {
            ensureHost();
            void refresh();
        }, 3000);

        renderTimer = window.setInterval(() => {
            if (currentState.available && currentState.playing)
                render();
        }, 1000);

        void refresh();
    },

    stop() {
        observer?.disconnect();
        observer = null;

        if (pollTimer !== null) {
            clearInterval(pollTimer);
            pollTimer = null;
        }

        if (renderTimer !== null) {
            clearInterval(renderTimer);
            renderTimer = null;
        }

        if (mountTimer !== null) {
            clearTimeout(mountTimer);
            mountTimer = null;
        }

        host?.remove();
        host = null;
        refreshing = false;
        busy = false;
    }
});
