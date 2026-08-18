import "./styles.css";

import definePlugin from "@utils/types";
import { ChannelStore, PresenceStore, UserStore } from "@webpack/common";

let observer: MutationObserver | null = null;
let raf = 0;
let interval: number | null = null;

const AVATAR_SELECTOR = [
    'img[class*="avatar_"]',
    '[class*="avatar_"] img',
    '[class*="avatarWrapper_"] img',
    '[class*="userProfile"] img[src*="/avatars/"]',
    '[class*="profile"] img[src*="/avatars/"]',
    '[role="dialog"] img[src*="/avatars/"]',
    'svg foreignObject img',
    'img[src*="/avatars/"]'
].join(",");

const ROW_SELECTOR = [
    '[data-list-item-id]',
    '[class*="member_"]',
    '[class*="peopleListItem_"]',
    '[class*="channel_"]',
    '[class*="userPopout_"]',
    '[class*="userProfileOuter_"]',
    '[class*="userProfileInner_"]',
    '[class*="profile_"]',
    '[role="dialog"]'
].join(",");

const STATUS_COLOURS = new Set([
    "#23a55a", "#40a258",
    "#f0b232", "#faa81a",
    "#f23f43", "#ed4245",
    "#80848e", "#82858f",
    "#593695", "#643da7"
]);

function normaliseStatus(status: string | null | undefined) {
    return ["online", "idle", "dnd", "offline"].includes(status ?? "")
        ? status!
        : "offline";
}

function snowflakes(v: string | null | undefined) {
    return v?.match(/\d{17,20}/g) ?? [];
}

function userIdFromAvatar(avatar: HTMLImageElement): string | null {
    try {
        return new URL(avatar.src).pathname.match(/\/avatars\/(\d{17,20})\//)?.[1] ?? null;
    } catch {
        return null;
    }
}

function userIdFromChannel(channelId: string): string | null {
    try {
        const channel: any = ChannelStore.getChannel(channelId);
        const recipients = channel?.recipients;
        if (!Array.isArray(recipients) || recipients.length !== 1) return null;

        const recipient = recipients[0];
        return typeof recipient === "string" ? recipient : recipient?.id ?? null;
    } catch {
        return null;
    }
}

function resolveUserId(row: HTMLElement, avatar: HTMLImageElement): string | null {
    const direct =
        row.getAttribute("data-user-id") ??
        row.querySelector<HTMLElement>("[data-user-id]")?.dataset.userId;

    if (direct && UserStore.getUser(direct)) return direct;

    for (const id of snowflakes(row.getAttribute("data-list-item-id")).reverse()) {
        if (UserStore.getUser(id)) return id;
        const dm = userIdFromChannel(id);
        if (dm) return dm;
    }

    const fromAvatar = userIdFromAvatar(avatar);
    return fromAvatar && UserStore.getUser(fromAvatar) ? fromAvatar : null;
}

function removeAvatarNotch(avatar: HTMLImageElement, host: HTMLElement) {
    const foreignObject = avatar.closest<SVGForeignObjectElement>("foreignObject");

    if (foreignObject) {
        const mask = foreignObject.getAttribute("mask") ?? "";

        if (mask.toLowerCase().includes("avatar-status")) {
            if (!foreignObject.dataset.tbOriginalMask)
                foreignObject.dataset.tbOriginalMask = mask;

            foreignObject.removeAttribute("mask");
            foreignObject.classList.add("tb-avatar-foreign-object");
        }
    }

    host.classList.add("tb-presence-host");
}

function looksLikeNativeStatusShape(
    element: SVGGraphicsElement,
    avatar: HTMLImageElement
) {
    const tag = element.tagName.toLowerCase();
    if (!["rect", "circle", "path"].includes(tag)) return false;

    const mask = (element.getAttribute("mask") ?? "").toLowerCase();
    const fill = (element.getAttribute("fill") ?? "").toLowerCase();

    const statusish =
        (mask.includes("status") && !mask.includes("avatar-status")) ||
        STATUS_COLOURS.has(fill);

    if (!statusish) return false;

    const a = avatar.getBoundingClientRect();
    const s = element.getBoundingClientRect();

    if (!a.width || !a.height || !s.width || !s.height)
        return mask.includes("status") && !mask.includes("avatar-status");

    const max = Math.max(a.width, a.height) * 0.55;
    return (
        s.width <= max &&
        s.height <= max &&
        s.left >= a.left + a.width * 0.40 &&
        s.top >= a.top + a.height * 0.40
    );
}

function hideNativeStatus(avatar: HTMLImageElement, host: HTMLElement) {
    const roots = new Set<Element>();
    const svg = avatar.closest("svg");
    if (svg) roots.add(svg);
    roots.add(host);

    for (const root of roots) {
        root.querySelectorAll<SVGGraphicsElement>(
            "svg rect, svg circle, svg path, rect, circle, path"
        ).forEach(el => {
            if (looksLikeNativeStatusShape(el, avatar))
                el.classList.add("tb-native-status-indicator");
        });
    }
}

function decorateAvatar(avatar: HTMLImageElement) {
    const context =
        avatar.closest<HTMLElement>(ROW_SELECTOR) ??
        avatar.closest<HTMLElement>('[class*="userProfile"]') ??
        avatar.closest<HTMLElement>('[class*="profile"]') ??
        avatar.closest<HTMLElement>('[role="dialog"]') ??
        avatar.parentElement;

    if (!context)
        return;

    const userId = resolveUserId(context, avatar);
    if (!userId)
        return;

    const status = normaliseStatus(PresenceStore.getStatus(userId));

    const host =
        avatar.closest<HTMLElement>('[class*="avatarWrapper_"]') ??
        avatar.closest<HTMLElement>('[class*="avatar_"]') ??
        avatar.closest<HTMLElement>("svg")?.parentElement ??
        avatar.parentElement;

    if (!host)
        return;

    context.dataset.tbPresence = status;
    context.dataset.tbUserId = userId;

    avatar.dataset.tbPresenceAvatar = status;
    avatar.classList.add("tb-presence-avatar");

    host.dataset.tbPresenceHost = status;

    removeAvatarNotch(avatar, host);
    hideNativeStatus(avatar, host);

    const profileAvatarArea =
        host.closest<HTMLElement>('[class*="avatar"]') ??
        host.parentElement;

    if (profileAvatarArea && profileAvatarArea !== host)
        hideNativeStatus(avatar, profileAvatarArea);
}

function decorateAll() {
    document.querySelectorAll<HTMLImageElement>(AVATAR_SELECTOR).forEach(decorateAvatar);
}

function scheduleDecorate() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
        raf = 0;
        decorateAll();
    });
}

function clearDecorations() {
    document.querySelectorAll<HTMLElement>("[data-tb-presence]").forEach(el => {
        delete el.dataset.tbPresence;
        delete el.dataset.tbUserId;
    });

    document.querySelectorAll<HTMLElement>("[data-tb-presence-avatar]").forEach(el => {
        delete el.dataset.tbPresenceAvatar;
        el.classList.remove("tb-presence-avatar");
    });

    document.querySelectorAll<HTMLElement>("[data-tb-presence-host]").forEach(el => {
        delete el.dataset.tbPresenceHost;
        el.classList.remove("tb-presence-host");
    });

    document.querySelectorAll<SVGForeignObjectElement>(
        "foreignObject[data-tb-original-mask]"
    ).forEach(el => {
        const original = el.dataset.tbOriginalMask;
        if (original) el.setAttribute("mask", original);
        delete el.dataset.tbOriginalMask;
        el.classList.remove("tb-avatar-foreign-object");
    });

    document.querySelectorAll<HTMLElement>(".tb-native-status-indicator")
        .forEach(el => el.classList.remove("tb-native-status-indicator"));
}

export default definePlugin({
    name: "TaxiwayPresenceRings",
    description: "Full 360-degree avatar presence rings across server members, Friends/Home and DMs.",
    authors: [{ name: "TaxiwayBravo", id: 325723086374567938n }],

    start() {
        decorateAll();

        observer = new MutationObserver(scheduleDecorate);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["src", "data-list-item-id", "data-user-id", "mask"]
        });

        interval = window.setInterval(decorateAll, 1250);
    },

    stop() {
        observer?.disconnect();
        observer = null;

        if (interval !== null) window.clearInterval(interval);
        interval = null;

        if (raf) cancelAnimationFrame(raf);
        raf = 0;

        clearDecorations();
    },

    flux: {
        PRESENCE_UPDATES() { scheduleDecorate(); },
        CHANNEL_UPDATES() { scheduleDecorate(); }
    }
});
