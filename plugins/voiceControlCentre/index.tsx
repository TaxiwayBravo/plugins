import "./styles.css";

import { ApplicationCommandInputType } from "@api/Commands";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, ConfirmModal, GuildStore, MediaEngineStore, openModal, React, SelectedChannelStore, Text, UserStore, VoiceStateStore } from "@webpack/common";

const { selectVoiceChannel } = findByPropsLazy("selectVoiceChannel", "selectChannel");

let connectedSince: number | null = null;
let lastVoiceChannelId: string | null = null;

function durationText(start: number | null) {
    if (!start) return "Not connected";
    const total = Math.max(0, Math.floor((Date.now() - start) / 1000));
    const hours = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return hours > 0 ? `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${mins}:${String(secs).padStart(2, "0")}`;
}

function selectedDeviceName(id: string, devices: Record<string, { name?: string; }> | undefined) {
    return devices?.[id]?.name ?? (id ? "Unknown device" : "System default");
}

function statusText(state: any) {
    const muted = !!(state?.mute || state?.selfMute);
    const deaf = !!(state?.deaf || state?.selfDeaf);
    if (deaf) return "Deafened";
    if (muted) return "Muted";
    return "Listening";
}

function MemberVolumeRow({ state, onChanged }: { state: any; onChanged: () => void; }) {
    const user = UserStore.getUser(state.userId);
    const me = UserStore.getCurrentUser();
    const isSelf = state.userId === me?.id;
    const [volume, setVolume] = React.useState(isSelf ? 100 : Math.round(MediaEngineStore.getLocalVolume(state.userId)));
    const name = user?.globalName ?? user?.username ?? state.userId;

    function changeVolume(value: number) {
        const next = Math.max(0, Math.min(200, value));
        setVolume(next);
        if (!isSelf) MediaEngineStore.setLocalVolume(state.userId, next);
        onChanged();
    }

    return (
        <div className="tb-vcc-member">
            <div className="tb-vcc-member-copy">
                <Text variant="text-md/semibold">{name}{isSelf ? " (You)" : ""}</Text>
                <Text variant="text-xs/normal" className="tb-vcc-muted">{statusText(state)}</Text>
            </div>
            {isSelf ? (
                <Text variant="text-sm/normal" className="tb-vcc-muted">Local user</Text>
            ) : (
                <div className="tb-vcc-volume">
                    <input type="range" min="0" max="200" step="5" value={volume} onChange={e => changeVolume(Number(e.currentTarget.value))} />
                    <span>{volume}%</span>
                </div>
            )}
        </div>
    );
}

function VoiceControlModal(props: Record<string, any>) {
    const [, redraw] = React.useState(0);
    React.useEffect(() => {
        const timer = window.setInterval(() => redraw(v => v + 1), 1000);
        return () => window.clearInterval(timer);
    }, []);

    const channelId = SelectedChannelStore.getVoiceChannelId();
    const channel = channelId ? ChannelStore.getChannel(channelId) : null;
    const guild = channel?.guild_id ? GuildStore.getGuild(channel.guild_id) : null;

    if (!channelId || !channel) {
        return (
            <ConfirmModal {...props} title="Voice Control Centre" confirmText="Close" cancelText="Close" onConfirm={() => { }}>
                <div className="tb-vcc-empty">
                    <Text variant="heading-md/semibold">Not connected to voice</Text>
                    <Text variant="text-sm/normal" className="tb-vcc-muted">Join a voice channel, then run /voicecontrol again.</Text>
                </div>
            </ConfirmModal>
        );
    }

    const states = Object.values(VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {}) as any[];
    const inputName = selectedDeviceName(MediaEngineStore.getInputDeviceId(), MediaEngineStore.getInputDevices());
    const outputName = selectedDeviceName(MediaEngineStore.getOutputDeviceId(), MediaEngineStore.getOutputDevices());
    const muted = MediaEngineStore.isSelfMute();
    const deafened = MediaEngineStore.isSelfDeaf();

    return (
        <ConfirmModal {...props} title="Voice Control Centre" confirmText="Close" cancelText="Close" onConfirm={() => { }}>
            <div className="tb-vcc-root">
                <div className="tb-vcc-hero">
                    <div>
                        <Text variant="heading-lg/semibold">{channel.name}</Text>
                        <Text variant="text-sm/normal" className="tb-vcc-muted">{guild?.name ?? "Direct message"} · Connected {durationText(connectedSince)}</Text>
                    </div>
                    <div className="tb-vcc-actions">
                        <button type="button" className={muted ? "tb-vcc-button active" : "tb-vcc-button"} onClick={() => { MediaEngineStore.setSelfMute(!MediaEngineStore.isSelfMute()); redraw(v => v + 1); }}>{muted ? "Unmute" : "Mute"}</button>
                        <button type="button" className={deafened ? "tb-vcc-button active" : "tb-vcc-button"} onClick={() => { MediaEngineStore.setSelfDeaf(!MediaEngineStore.isSelfDeaf()); redraw(v => v + 1); }}>{deafened ? "Undeafen" : "Deafen"}</button>
                        <button type="button" className="tb-vcc-button danger" onClick={() => { selectVoiceChannel(null); redraw(v => v + 1); }}>Disconnect</button>
                    </div>
                </div>

                <div className="tb-vcc-devices">
                    <div className="tb-vcc-device"><Text variant="text-xs/semibold" className="tb-vcc-label">INPUT DEVICE</Text><Text variant="text-sm/normal">{inputName}</Text><Text variant="text-xs/normal" className="tb-vcc-muted">Input volume: {Math.round(MediaEngineStore.getInputVolume())}%</Text></div>
                    <div className="tb-vcc-device"><Text variant="text-xs/semibold" className="tb-vcc-label">OUTPUT DEVICE</Text><Text variant="text-sm/normal">{outputName}</Text></div>
                </div>

                <div>
                    <Text variant="heading-md/semibold">Connected users — {states.length}</Text>
                    <div className="tb-vcc-members">{states.map(state => <MemberVolumeRow key={state.userId} state={state} onChanged={() => redraw(v => v + 1)} />)}</div>
                </div>
            </div>
        </ConfirmModal>
    );
}

function openVoiceControl() { openModal(props => <VoiceControlModal {...props} />); }

export default definePlugin({
    name: "VoiceControlCentre",
    description: "A central voice panel with connection details, mute/deafen controls, devices and per-user volume.",
    authors: [{ name: "TaxiwayBravo", id: 325723086374567938n }],
    tags: ["Voice", "Utility"],
    commands: [{ inputType: ApplicationCommandInputType.BUILT_IN, name: "voicecontrol", description: "Open TaxiwayBravo Voice Control Centre", execute: () => openVoiceControl() }],
    flux: {
        VOICE_STATE_UPDATES() {
            const channelId = SelectedChannelStore.getVoiceChannelId();
            if (channelId && channelId !== lastVoiceChannelId) connectedSince = Date.now();
            if (!channelId) connectedSince = null;
            lastVoiceChannelId = channelId ?? null;
        },
        CHANNEL_SELECT() {
            const channelId = SelectedChannelStore.getVoiceChannelId();
            if (channelId && !lastVoiceChannelId) connectedSince = Date.now();
            if (!channelId) connectedSince = null;
            lastVoiceChannelId = channelId ?? null;
        }
    },
    start() {
        lastVoiceChannelId = SelectedChannelStore.getVoiceChannelId() ?? null;
        connectedSince = lastVoiceChannelId ? Date.now() : null;
    },
    stop() { connectedSince = null; lastVoiceChannelId = null; }
});
