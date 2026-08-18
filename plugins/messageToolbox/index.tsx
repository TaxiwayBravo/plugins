import definePlugin from "@utils/types";
import { Menu, showToast, Toasts } from "@webpack/common";

function quote(text: string) { return text.split("\n").map(line => `> ${line || " "}`).join("\n"); }
function feedHistory(text: string, source: string) { window.dispatchEvent(new CustomEvent("TaxiwayBravoClipboardCopy", { detail: { text, source } })); }
async function copy(text: string, source: string) {
    if (!text) return showToast("Nothing to copy", Toasts.Type.FAILURE);
    try { await navigator.clipboard.writeText(text); feedHistory(text, source); showToast("Copied", Toasts.Type.SUCCESS); }
    catch { showToast("Could not access the clipboard", Toasts.Type.FAILURE); }
}
function link(message: any, channel: any) { return `https://discord.com/channels/${message.guild_id ?? channel?.guild_id ?? "@me"}/${message.channel_id}/${message.id}`; }
function full(message: any) {
    const author = message.author?.globalName ?? message.author?.username ?? message.author?.id ?? "Unknown user";
    const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : "Unknown time";
    return `${author} — ${timestamp}\n${message.content ?? ""}`;
}
function discordTime(message: any) { return `<t:${Math.floor((message.timestamp ? new Date(message.timestamp).getTime() : Date.now()) / 1000)}:F>`; }

export default definePlugin({
    name: "MessageToolbox",
    description: "Adds useful copy, quote, timestamp and metadata tools to message context menus.",
    authors: [{ name: "TaxiwayBravo", id: 325723086374567938n }],
    tags: ["Messages", "Utility"],
    contextMenus: {
        "message-context"(children, props: any) {
            const message = props?.message;
            const channel = props?.channel;
            if (!message) return;
            const content = message.content ?? "";
            children.push(
                <Menu.MenuItem id="tb-message-toolbox" label="Message Toolbox">
                    <Menu.MenuItem id="tb-message-copy-clean" label="Copy clean text" action={() => void copy(content, "Message Toolbox · Clean text")} />
                    <Menu.MenuItem id="tb-message-copy-quote" label="Copy as quote" action={() => void copy(quote(content), "Message Toolbox · Quote")} />
                    <Menu.MenuItem id="tb-message-copy-full" label="Copy message + author + time" action={() => void copy(full(message), "Message Toolbox · Full message")} />
                    <Menu.MenuItem id="tb-message-copy-link" label="Copy message link" action={() => void copy(link(message, channel), "Message Toolbox · Message link")} />
                    <Menu.MenuItem id="tb-message-copy-time" label="Copy Discord timestamp" action={() => void copy(discordTime(message), "Message Toolbox · Timestamp")} />
                    <Menu.MenuSeparator />
                    <Menu.MenuItem id="tb-message-copy-author-id" label="Copy author ID" action={() => void copy(message.author?.id ?? "", "Message Toolbox · Author ID")} />
                    <Menu.MenuItem id="tb-message-copy-message-id" label="Copy message ID" action={() => void copy(message.id, "Message Toolbox · Message ID")} />
                    <Menu.MenuItem id="tb-message-copy-channel-id" label="Copy channel ID" action={() => void copy(message.channel_id, "Message Toolbox · Channel ID")} />
                    <Menu.MenuItem id="tb-message-copy-json" label="Copy basic metadata JSON" action={() => void copy(JSON.stringify({ messageId: message.id, channelId: message.channel_id, guildId: message.guild_id ?? channel?.guild_id ?? null, authorId: message.author?.id ?? null, author: message.author?.username ?? null, timestamp: message.timestamp ?? null, content }, null, 2), "Message Toolbox · Metadata")} />
                </Menu.MenuItem>
            );
        }
    }
});
