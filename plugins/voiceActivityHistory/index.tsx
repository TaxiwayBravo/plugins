/*
 * VoiceActivityHistory - TaxiwayBravo Vencord plugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ApplicationCommandInputType } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import definePlugin from "@utils/types";
import {
    AuthenticationStore,
    ChannelStore,
    ConfirmModal,
    GuildMemberStore,
    GuildStore,
    openModal,
    React,
    SelectedChannelStore,
    showToast,
    Text,
    Toasts,
    UserStore
} from "@webpack/common";

const STORE_KEY = "TaxiwayBravo_VoiceActivityHistory_v1";
const MAX_HISTORY = 300;

type ActivityType = "join" | "leave" | "move";

interface VoiceStateChangeEvent {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
    deaf: boolean;
    mute: boolean;
    selfDeaf: boolean;
    selfMute: boolean;
    sessionId: string;
}

interface VoiceActivityEntry {
    id: string;
    timestamp: number;
    type: ActivityType;
    userId: string;
    username: string;
    displayName: string;
    guildId?: string;
    guildName: string;
    fromChannelId?: string;
    fromChannelName?: string;
    toChannelId?: string;
    toChannelName?: string;
    isSelf: boolean;
}

let history: VoiceActivityEntry[] = [];
let myLastChannelId: string | undefined;
let saveTimer: number | null = null;

function scheduleSave() {
    if (saveTimer !== null)
        window.clearTimeout(saveTimer);

    saveTimer = window.setTimeout(() => {
        saveTimer = null;
        void DataStore.set(STORE_KEY, history);
    }, 250);
}

function channelName(channelId?: string) {
    return channelId
        ? ChannelStore.getChannel(channelId)?.name ?? "Unknown channel"
        : undefined;
}

function guildInfo(channelId?: string) {
    const channel = channelId
        ? ChannelStore.getChannel(channelId)
        : undefined;

    const guildId = channel?.guild_id;
    const guild = guildId
        ? GuildStore.getGuild(guildId)
        : undefined;

    return {
        guildId,
        guildName: guild?.name ?? "Unknown server"
    };
}

function userInfo(userId: string, guildId?: string) {
    const user = UserStore.getUser(userId);
    const username = user?.username ?? userId;
    const displayName =
        (guildId
            ? GuildMemberStore.getNick(guildId, userId)
            : undefined) ??
        user?.globalName ??
        username;

    return { username, displayName };
}

function makeEntry(
    type: ActivityType,
    state: VoiceStateChangeEvent,
    oldChannelId: string | undefined,
    channelId: string | undefined,
    isSelf: boolean
): VoiceActivityEntry {
    const relevantChannelId = channelId ?? oldChannelId;
    const { guildId, guildName } = guildInfo(relevantChannelId);
    const { username, displayName } = userInfo(state.userId, guildId);

    return {
        id: `${Date.now()}-${state.userId}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        type,
        userId: state.userId,
        username,
        displayName,
        guildId,
        guildName,
        fromChannelId: oldChannelId,
        fromChannelName: channelName(oldChannelId),
        toChannelId: channelId,
        toChannelName: channelName(channelId),
        isSelf
    };
}

function appendEntry(entry: VoiceActivityEntry) {
    history = [entry, ...history].slice(0, MAX_HISTORY);
    scheduleSave();
}

function resolveType(
    oldChannelId: string | undefined,
    channelId: string | undefined
): ActivityType | null {
    if (oldChannelId === channelId)
        return null;

    if (!oldChannelId && channelId)
        return "join";

    if (oldChannelId && !channelId)
        return "leave";

    if (oldChannelId && channelId)
        return "move";

    return null;
}

function formatClock(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

function formatDate(timestamp: number) {
    return new Date(timestamp).toLocaleDateString([], {
        day: "2-digit",
        month: "short",
        year: "numeric"
    });
}

function actionText(entry: VoiceActivityEntry) {
    switch (entry.type) {
        case "join":
            return `joined ${entry.toChannelName ?? "voice"}`;
        case "leave":
            return `left ${entry.fromChannelName ?? "voice"}`;
        case "move":
            return `moved from ${entry.fromChannelName ?? "voice"} to ${entry.toChannelName ?? "voice"}`;
    }
}

function typeLabel(type: ActivityType) {
    switch (type) {
        case "join": return "JOIN";
        case "leave": return "LEAVE";
        case "move": return "MOVE";
    }
}

function HistoryRow({ entry }: { entry: VoiceActivityEntry; }) {
    return (
        <div className="tb-vah-row">
            <div className={`tb-vah-type tb-vah-type-${entry.type}`}>
                {typeLabel(entry.type)}
            </div>

            <div className="tb-vah-copy">
                <Text variant="text-md/semibold" className="tb-vah-user">
                    {entry.displayName}
                    {entry.isSelf ? " (You)" : ""}
                </Text>

                <Text variant="text-sm/normal" className="tb-vah-action">
                    {actionText(entry)}
                </Text>

                <Text variant="text-xs/normal" className="tb-vah-meta">
                    {entry.guildName} · {formatDate(entry.timestamp)} · {formatClock(entry.timestamp)}
                </Text>
            </div>
        </div>
    );
}

function VoiceHistoryModal(props: Record<string, any>) {
    const [items, setItems] = React.useState(() => history.slice());

    async function clearHistory() {
        history = [];
        setItems([]);
        await DataStore.set(STORE_KEY, history);

        showToast(
            "Voice activity history cleared",
            Toasts.Type.SUCCESS
        );
    }

    return (
        <ConfirmModal
            {...props}
            title={`Voice Activity History — ${items.length}`}
            confirmText="Close"
            cancelText="Close"
            onConfirm={() => { }}
        >
            <div className="tb-vah-root">
                <div className="tb-vah-toolbar">
                    <Text variant="text-sm/normal" className="tb-vah-muted">
                        Local history of voice joins, leaves and moves relevant to your voice sessions.
                    </Text>

                    <button
                        type="button"
                        className="tb-vah-clear"
                        disabled={items.length === 0}
                        onClick={() => void clearHistory()}
                    >
                        Clear history
                    </button>
                </div>

                {items.length === 0 ? (
                    <div className="tb-vah-empty">
                        <Text variant="text-md/normal">
                            No voice activity recorded yet.
                        </Text>

                        <Text variant="text-sm/normal" className="tb-vah-muted">
                            Join a voice channel and events will appear here.
                        </Text>
                    </div>
                ) : (
                    <div className="tb-vah-list">
                        {items.map(entry => (
                            <HistoryRow key={entry.id} entry={entry} />
                        ))}
                    </div>
                )}
            </div>
        </ConfirmModal>
    );
}

function openHistory() {
    openModal(props => <VoiceHistoryModal {...props} />);
}

export default definePlugin({
    name: "VoiceActivityHistory",
    description: "Keeps a local history of users joining, leaving and moving around your voice sessions.",
    authors: [
        {
            name: "TaxiwayBravo",
            id: 325723086374567938n
        }
    ],
    tags: ["Voice", "Utility"],

    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "voicehistory",
            description: "Open your local voice activity history",
            execute: () => {
                openHistory();
            }
        }
    ],

    flux: {
        VOICE_STATE_UPDATES({
            voiceStates
        }: {
            voiceStates: VoiceStateChangeEvent[];
        }) {
            const me = UserStore.getCurrentUser();
            if (!me)
                return;

            const currentVoiceChannelId =
                SelectedChannelStore.getVoiceChannelId() ?? undefined;

            for (const state of voiceStates) {
                const isSelf = state.userId === me.id;

                if (
                    isSelf &&
                    state.sessionId !== AuthenticationStore.getSessionId()
                ) {
                    continue;
                }

                let oldChannelId = state.oldChannelId;
                const channelId = state.channelId;

                if (isSelf) {
                    oldChannelId = myLastChannelId;
                    myLastChannelId = channelId;
                }

                const type = resolveType(oldChannelId, channelId);
                if (!type)
                    continue;

                if (!isSelf) {
                    if (!currentVoiceChannelId)
                        continue;

                    if (
                        channelId !== currentVoiceChannelId &&
                        oldChannelId !== currentVoiceChannelId
                    ) {
                        continue;
                    }
                }

                appendEntry(
                    makeEntry(
                        type,
                        state,
                        oldChannelId,
                        channelId,
                        isSelf
                    )
                );
            }
        }
    },

    async start() {
        const stored =
            await DataStore.get<VoiceActivityEntry[]>(STORE_KEY);

        history = Array.isArray(stored)
            ? stored
                .filter(entry =>
                    entry &&
                    typeof entry.timestamp === "number" &&
                    typeof entry.userId === "string"
                )
                .slice(0, MAX_HISTORY)
            : [];

        myLastChannelId =
            SelectedChannelStore.getVoiceChannelId() ?? undefined;
    },

    stop() {
        if (saveTimer !== null) {
            window.clearTimeout(saveTimer);
            saveTimer = null;
        }

        void DataStore.set(STORE_KEY, history);
        myLastChannelId = undefined;
    }
});