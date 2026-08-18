/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { Channel } from "@vencord/discord-types";
import {
    ChannelStore,
    ConfirmModal,
    GuildRoleStore,
    Menu,
    openModal,
    PermissionsBits,
    PermissionStore,
    showToast,
    Text,
    Toasts,
    UserStore
} from "@webpack/common";

type Overwrite = {
    id: string;
    type: number;
    allow: bigint | string | number;
    deny: bigint | string | number;
};

function toBigInt(value: unknown): bigint {
    try {
        if (typeof value === "bigint") return value;
        if (typeof value === "number") return BigInt(value);
        if (typeof value === "string") return BigInt(value);
    } catch { }

    return 0n;
}

function copy(text: string) {
    navigator.clipboard.writeText(text).then(
        () => showToast("Copied to clipboard", Toasts.Type.SUCCESS),
        () => showToast("Failed to copy", Toasts.Type.FAILURE)
    );
}

function getChannelTypeName(channel: Channel) {
    if (channel.isCategory?.()) return "Category";
    if (channel.isGuildVocal?.()) return "Voice / Stage";
    if (channel.isThread?.()) return "Thread";

    switch (channel.type) {
        case 0: return "Text";
        case 2: return "Voice";
        case 4: return "Category";
        case 5: return "Announcement";
        case 13: return "Stage";
        case 15: return "Forum";
        case 16: return "Media";
        default: return `Type ${channel.type}`;
    }
}

function permissionName(bit: bigint) {
    const entries: [bigint, string][] = [
        [toBigInt(PermissionsBits.VIEW_CHANNEL), "View Channel"],
        [toBigInt(PermissionsBits.SEND_MESSAGES), "Send Messages"],
        [toBigInt(PermissionsBits.READ_MESSAGE_HISTORY), "Read Message History"],
        [toBigInt(PermissionsBits.CONNECT), "Connect"],
        [toBigInt(PermissionsBits.SPEAK), "Speak"],
        [toBigInt(PermissionsBits.MANAGE_CHANNELS), "Manage Channel"],
        [toBigInt(PermissionsBits.MANAGE_MESSAGES), "Manage Messages"]
    ];

    return entries
        .filter(([flag]) => flag !== 0n && (bit & flag) === flag)
        .map(([, name]) => name);
}

function resolveRoleName(channel: Channel, roleId: string) {
    try {
        if (roleId === channel.guild_id)
            return "@everyone";

        const role =
            GuildRoleStore.getRole?.(channel.guild_id, roleId) ??
            GuildRoleStore.getRolesSnapshot?.(channel.guild_id)?.[roleId];

        return role?.name ? `@${role.name}` : null;
    } catch {
        return null;
    }
}

function getOverwriteLabel(channel: Channel, overwrite: Overwrite) {
    if (overwrite.type === 0) {
        const roleName = resolveRoleName(channel, overwrite.id);
        return roleName ? `Role: ${roleName}` : `Role: ${overwrite.id}`;
    }

    const user = UserStore.getUser(overwrite.id);
    if (user) return `User: ${user.globalName || user.username}`;

    return `User: ${overwrite.id}`;
}

function getOverwritePrincipal(channel: Channel, overwrite: Overwrite) {
    if (overwrite.type === 0)
        return resolveRoleName(channel, overwrite.id) ?? overwrite.id;

    const user = UserStore.getUser(overwrite.id);
    return user ? (user.globalName || user.username) : overwrite.id;
}

function getOverwrites(channel: Channel): Overwrite[] {
    const raw = (channel as any).permissionOverwrites;

    if (!raw) return [];
    if (Array.isArray(raw)) return raw;

    return Object.values(raw) as Overwrite[];
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean; }) {
    return (
        <div className="vc-hcip-row">
            <Text variant="text-sm/semibold" className="vc-hcip-label">{label}</Text>
            <Text
                variant="text-sm/normal"
                className={mono ? "vc-hcip-value vc-hcip-mono" : "vc-hcip-value"}
                selectable
            >
                {value || "—"}
            </Text>
        </div>
    );
}

function HiddenChannelInfoModal({ channel, ...props }: { channel: Channel; } & Record<string, any>) {
    const parent = channel.parent_id ? ChannelStore.getChannel(channel.parent_id) : null;
    const overwrites = getOverwrites(channel);

    const metadata = {
        id: channel.id,
        guildId: channel.guild_id,
        name: channel.name,
        type: channel.type,
        typeName: getChannelTypeName(channel),
        parentId: channel.parent_id ?? null,
        parentName: parent?.name ?? null,
        topic: (channel as any).topic ?? null,
        nsfw: (channel as any).nsfw ?? false,
        position: (channel as any).position ?? null,
        rateLimitPerUser: (channel as any).rateLimitPerUser ?? 0,
        bitrate: (channel as any).bitrate ?? null,
        userLimit: (channel as any).userLimit ?? null,
        permissionOverwrites: overwrites.map(o => ({
            id: o.id,
            type: o.type,
            label: getOverwriteLabel(channel, o),
            principal: getOverwritePrincipal(channel, o),
            allow: String(o.allow ?? 0),
            deny: String(o.deny ?? 0)
        }))
    };

    return (
        <ConfirmModal
            {...props}
            title={`Hidden Channel Info+ — #${channel.name}`}
            confirmText="Copy Metadata JSON"
            cancelText="Close"
            onConfirm={() => copy(JSON.stringify(metadata, null, 2))}
        >
            <div className="vc-hcip-root">
                <div className="vc-hcip-notice">
                    This shows metadata Discord has already sent to your client. It cannot reveal messages or files that Discord did not send.
                </div>

                <div className="vc-hcip-section">
                    <Text variant="heading-md/semibold">Channel</Text>
                    <InfoRow label="Name" value={`#${channel.name}`} />
                    <InfoRow label="Channel ID" value={channel.id} mono />
                    <InfoRow label="Guild ID" value={channel.guild_id} mono />
                    <InfoRow label="Type" value={getChannelTypeName(channel)} />
                    <InfoRow label="Category" value={parent ? `${parent.name} (${parent.id})` : "None / not supplied"} />
                    <InfoRow label="Position" value={String((channel as any).position ?? "Not supplied")} />
                    <InfoRow label="Topic" value={(channel as any).topic || "Not supplied"} />
                </div>

                <div className="vc-hcip-section">
                    <Text variant="heading-md/semibold">Channel flags</Text>
                    <InfoRow label="NSFW" value={(channel as any).nsfw ? "Yes" : "No"} />
                    <InfoRow label="Slowmode" value={`${(channel as any).rateLimitPerUser ?? 0} seconds`} />
                    {(channel as any).bitrate != null && (
                        <InfoRow label="Bitrate" value={`${Math.round((channel as any).bitrate / 1000)} kbps`} />
                    )}
                    {(channel as any).userLimit != null && (
                        <InfoRow label="User limit" value={String((channel as any).userLimit || "Unlimited")} />
                    )}
                </div>

                <div className="vc-hcip-section">
                    <Text variant="heading-md/semibold">Permission overwrites ({overwrites.length})</Text>
                    {overwrites.length === 0 ? (
                        <Text variant="text-sm/normal" className="vc-hcip-muted">
                            No channel-specific overwrites were supplied to the client.
                        </Text>
                    ) : overwrites.map((overwrite, index) => {
                        const allow = toBigInt(overwrite.allow);
                        const deny = toBigInt(overwrite.deny);
                        const allowedNames = permissionName(allow);
                        const deniedNames = permissionName(deny);

                        return (
                            <div className="vc-hcip-overwrite" key={`${overwrite.id}-${index}`}>
                                <Text variant="text-sm/semibold">{getOverwriteLabel(channel, overwrite)}</Text>
                                <InfoRow label={overwrite.type === 0 ? "Role" : "Member"} value={getOverwritePrincipal(channel, overwrite)} />
                                <InfoRow label="Discord ID" value={overwrite.id} mono />
                                <InfoRow label="Allow bitfield" value={String(overwrite.allow ?? 0)} mono />
                                <InfoRow label="Deny bitfield" value={String(overwrite.deny ?? 0)} mono />
                                <InfoRow label="Recognised allows" value={allowedNames.length ? allowedNames.join(", ") : "None"} />
                                <InfoRow label="Recognised denies" value={deniedNames.length ? deniedNames.join(", ") : "None"} />
                            </div>
                        );
                    })}
                </div>
            </div>
        </ConfirmModal>
    );
}

function openHiddenInfo(channel: Channel) {
    openModal(props => <HiddenChannelInfoModal {...props} channel={channel} />);
}

const patchChannelContextMenu: NavContextMenuPatchCallback = (children, { channel }) => {
    if (!channel?.guild_id) return;
    if (PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel)) return;

    const group = findGroupChildrenByChildId(["copy-channel-id"], children) ?? children;

    group.push(
        <Menu.MenuItem
            id="vc-hidden-channel-info-plus"
            label="Hidden Channel Info+"
            action={() => openHiddenInfo(channel)}
        />
    );
};

export default definePlugin({
    name: "HiddenChannelInfoPlus",
    description: "Shows all locally available metadata for hidden channels exposed by Discord.",
    authors: [{ name: "TaxiwayBravo", id: 325723086374567938n }],
    dependencies: ["ShowHiddenChannels"],

    contextMenus: {
        "channel-context": patchChannelContextMenu
    }
});
