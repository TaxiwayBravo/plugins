import "./styles.css";

import { ApplicationCommandInputType, ApplicationCommandOptionType } from "@api/Commands";
import definePlugin from "@utils/types";
import { ConfirmModal, GuildMemberStore, GuildRoleStore, GuildStore, Menu, openModal, PermissionsBits, SelectedGuildStore, showToast, Text, Toasts } from "@webpack/common";

function snowflakeDate(id: string) {
    try { return new Date(Number((BigInt(id) >> 22n) + 1420070400000n)); }
    catch { return null; }
}
function roleColour(role: any) {
    if (role.colorString) return role.colorString;
    if (role.color) return `#${Number(role.color).toString(16).padStart(6, "0")}`;
    return "Default";
}
function friendlyPermissionName(key: string) {
    return key.toLowerCase().split("_").map(part => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
}
function permissionNames(role: any) {
    let bits: bigint;
    try { bits = BigInt(role.permissions ?? 0); } catch { bits = 0n; }
    const seen = new Set<string>();
    const names: string[] = [];
    for (const [key, value] of Object.entries(PermissionsBits as any)) {
        if (typeof value !== "bigint" || value === 0n || (bits & value) !== value) continue;
        const friendly = friendlyPermissionName(key);
        if (!seen.has(friendly)) { seen.add(friendly); names.push(friendly); }
    }
    return names.sort((a, b) => a.localeCompare(b));
}
function cachedMemberCount(guildId: string, roleId: string) {
    return GuildMemberStore.getMembers(guildId).filter(member => member.roles?.includes(roleId)).length;
}
async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); showToast("Copied", Toasts.Type.SUCCESS); }
    catch { showToast("Could not access the clipboard", Toasts.Type.FAILURE); }
}
function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean; }) {
    return <div className="tb-role-row"><Text variant="text-sm/semibold" className="tb-role-label">{label}</Text><Text variant="text-sm/normal" className={mono ? "tb-role-value mono" : "tb-role-value"} selectable>{value}</Text></div>;
}
function RoleInspectorModal({ guildId, roleId, ...props }: { guildId: string; roleId: string; } & Record<string, any>) {
    const guild = GuildStore.getGuild(guildId);
    const role = GuildRoleStore.getRole(guildId, roleId);
    if (!guild || !role) return null;
    const created = snowflakeDate(role.id);
    const permissions = permissionNames(role);
    const count = cachedMemberCount(guildId, roleId);
    const metadata = { id: role.id, guildId, guildName: guild.name, name: role.name, color: roleColour(role), position: role.position, hoist: !!role.hoist, mentionable: !!role.mentionable, managed: !!role.managed, permissions: String(role.permissions ?? 0), permissionNames: permissions, cachedMemberCount: count, createdAt: created?.toISOString() ?? null, icon: role.icon ?? null, unicodeEmoji: role.unicodeEmoji ?? null };
    return (
        <ConfirmModal {...props} title={`Role Inspector — @${role.name}`} confirmText="Copy metadata JSON" cancelText="Close" onConfirm={() => void copy(JSON.stringify(metadata, null, 2))}>
            <div className="tb-role-root">
                <div className="tb-role-section">
                    <Text variant="heading-md/semibold">Role</Text>
                    <InfoRow label="Name" value={`@${role.name}`} /><InfoRow label="Role ID" value={role.id} mono /><InfoRow label="Server" value={guild.name} /><InfoRow label="Server ID" value={guild.id} mono /><InfoRow label="Colour" value={roleColour(role)} mono /><InfoRow label="Position" value={String(role.position)} /><InfoRow label="Created" value={created?.toLocaleString() ?? "Unknown"} /><InfoRow label="Cached members" value={String(count)} />
                </div>
                <div className="tb-role-section">
                    <Text variant="heading-md/semibold">Flags</Text>
                    <InfoRow label="Hoisted" value={role.hoist ? "Yes" : "No"} /><InfoRow label="Mentionable" value={role.mentionable ? "Yes" : "No"} /><InfoRow label="Managed / integration role" value={role.managed ? "Yes" : "No"} /><InfoRow label="Role icon" value={role.icon ?? "None"} mono /><InfoRow label="Unicode emoji" value={role.unicodeEmoji ?? "None"} />
                </div>
                <div className="tb-role-section">
                    <Text variant="heading-md/semibold">Permissions — {permissions.length}</Text>
                    <InfoRow label="Bitfield" value={String(role.permissions ?? 0)} mono />
                    <div className="tb-role-permissions">{permissions.length === 0 ? <Text variant="text-sm/normal" className="tb-role-muted">No recognised permissions.</Text> : permissions.map(permission => <span key={permission} className="tb-role-permission">{permission}</span>)}</div>
                </div>
            </div>
        </ConfirmModal>
    );
}
function openRoleInspector(guildId: string, roleId: string) { openModal(props => <RoleInspectorModal {...props} guildId={guildId} roleId={roleId} />); }

export default definePlugin({
    name: "RoleInspector",
    description: "Inspect Discord role metadata, permissions, flags, colour, creation time and cached member count.",
    authors: [{ name: "TaxiwayBravo", id: 325723086374567938n }],
    tags: ["Roles", "Utility"],
    commands: [{ inputType: ApplicationCommandInputType.BUILT_IN, name: "roleinspect", description: "Inspect a role in the current server", options: [{ name: "role", description: "Role to inspect", type: ApplicationCommandOptionType.ROLE, required: true }], execute: (args, ctx) => { const guildId = ctx.guild?.id ?? SelectedGuildStore.getGuildId(); const roleId = args.find(arg => arg.name === "role")?.value; if (guildId && roleId) openRoleInspector(guildId, String(roleId)); } }],
    contextMenus: {
        "dev-context"(children, { id }: { id: string; }) {
            const guildId = SelectedGuildStore.getGuildId();
            if (!guildId) return;
            const role = GuildRoleStore.getRole(guildId, id);
            if (!role) return;
            children.unshift(<Menu.MenuItem id="tb-role-inspector" label="Role Inspector" action={() => openRoleInspector(guildId, role.id)} />);
        }
    }
});
