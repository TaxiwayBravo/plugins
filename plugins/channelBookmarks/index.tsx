/*
 * ChannelBookmarks - TaxiwayBravo Vencord plugin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ApplicationCommandInputType } from "@api/Commands";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import definePlugin from "@utils/types";
import { Channel } from "@vencord/discord-types";
import {
    ChannelRouter,
    ChannelStore,
    ConfirmModal,
    GuildStore,
    Menu,
    openModal,
    React,
    showToast,
    Text,
    Toasts
} from "@webpack/common";

const STORE_KEY = "TaxiwayBravo_ChannelBookmarks_v1";

interface Bookmark {
    guildId: string;
    channelId: string;
    addedAt: number;
}

let bookmarks: Bookmark[] = [];

function isBookmarked(channelId: string) {
    return bookmarks.some(bookmark => bookmark.channelId === channelId);
}

async function saveBookmarks() {
    await DataStore.set(STORE_KEY, bookmarks);
}

async function addBookmark(channel: Channel) {
    if (!channel.guild_id || isBookmarked(channel.id))
        return;

    bookmarks = [
        ...bookmarks,
        {
            guildId: channel.guild_id,
            channelId: channel.id,
            addedAt: Date.now()
        }
    ];

    await saveBookmarks();

    showToast(
        `Bookmarked #${channel.name}`,
        Toasts.Type.SUCCESS
    );
}

async function removeBookmark(channelId: string) {
    const channel = ChannelStore.getChannel(channelId);

    bookmarks = bookmarks.filter(
        bookmark => bookmark.channelId !== channelId
    );

    await saveBookmarks();

    showToast(
        channel?.name
            ? `Removed #${channel.name} from bookmarks`
            : "Removed channel bookmark",
        Toasts.Type.SUCCESS
    );
}

function openBookmark(bookmark: Bookmark) {
    const channel = ChannelStore.getChannel(bookmark.channelId);

    if (!channel) {
        showToast(
            "That channel is not currently available to Discord.",
            Toasts.Type.FAILURE
        );
        return;
    }

    ChannelRouter.transitionToChannel(bookmark.channelId);
}

function BookmarkRow({
    bookmark,
    onRemove
}: {
    bookmark: Bookmark;
    onRemove: (channelId: string) => void;
}) {
    const channel = ChannelStore.getChannel(bookmark.channelId);
    const guild = GuildStore.getGuild(bookmark.guildId);

    const unavailable = !channel;

    return (
        <div className="tb-channel-bookmark-row">
            <div className="tb-channel-bookmark-copy">
                <Text
                    variant="text-md/semibold"
                    className="tb-channel-bookmark-name"
                >
                    {channel ? `#${channel.name}` : "Unavailable channel"}
                </Text>

                <Text
                    variant="text-xs/normal"
                    className="tb-channel-bookmark-guild"
                >
                    {guild?.name ?? "Unknown server"}
                </Text>
            </div>

            <div className="tb-channel-bookmark-actions">
                <button
                    type="button"
                    className="tb-channel-bookmark-button tb-channel-bookmark-open"
                    disabled={unavailable}
                    onClick={() => openBookmark(bookmark)}
                >
                    Open
                </button>

                <button
                    type="button"
                    className="tb-channel-bookmark-button tb-channel-bookmark-remove"
                    onClick={() => onRemove(bookmark.channelId)}
                >
                    Remove
                </button>
            </div>
        </div>
    );
}

function BookmarksModal(props: Record<string, any>) {
    const [items, setItems] = React.useState(() =>
        bookmarks
            .slice()
            .sort((a, b) => b.addedAt - a.addedAt)
    );

    async function handleRemove(channelId: string) {
        await removeBookmark(channelId);

        setItems(
            bookmarks
                .slice()
                .sort((a, b) => b.addedAt - a.addedAt)
        );
    }

    return (
        <ConfirmModal
            {...props}
            title={`Channel Bookmarks — ${items.length}`}
            confirmText="Close"
            cancelText="Close"
            onConfirm={() => { }}
        >
            <div className="tb-channel-bookmarks-root">
                {items.length === 0 ? (
                    <div className="tb-channel-bookmarks-empty">
                        <Text variant="text-md/normal">
                            You have no bookmarked channels yet.
                        </Text>

                        <Text
                            variant="text-sm/normal"
                            className="tb-channel-bookmarks-muted"
                        >
                            Right-click a server channel and choose Bookmark channel.
                        </Text>
                    </div>
                ) : (
                    items.map(bookmark => (
                        <BookmarkRow
                            key={bookmark.channelId}
                            bookmark={bookmark}
                            onRemove={handleRemove}
                        />
                    ))
                )}
            </div>
        </ConfirmModal>
    );
}

function openBookmarksModal() {
    openModal(props => <BookmarksModal {...props} />);
}

const patchChannelContextMenu: NavContextMenuPatchCallback = (
    children,
    { channel }
) => {
    if (!channel?.guild_id)
        return;

    const bookmarked = isBookmarked(channel.id);

    const group =
        findGroupChildrenByChildId(["copy-channel-id"], children) ??
        children;

    group.push(
        <Menu.MenuItem
            id="tb-channel-bookmark"
            label={bookmarked ? "Remove bookmark" : "Bookmark channel"}
            action={() => {
                if (bookmarked)
                    void removeBookmark(channel.id);
                else
                    void addBookmark(channel);
            }}
        />,
        <Menu.MenuItem
            id="tb-open-channel-bookmarks"
            label="View channel bookmarks"
            action={openBookmarksModal}
        />
    );
};

export default definePlugin({
    name: "ChannelBookmarks",
    description: "Bookmark channels across different servers and jump back to them from one local list.",
    authors: [
        {
            name: "TaxiwayBravo",
            id: 325723086374567938n
        }
    ],
    tags: ["Utility", "Organisation"],

    contextMenus: {
        "channel-context": patchChannelContextMenu
    },

    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "bookmarks",
            description: "Open your saved channel bookmarks",
            execute: () => {
                openBookmarksModal();
            }
        }
    ],

    async start() {
        const saved = await DataStore.get<Bookmark[]>(STORE_KEY);

        bookmarks = Array.isArray(saved)
            ? saved.filter(
                item =>
                    item &&
                    typeof item.guildId === "string" &&
                    typeof item.channelId === "string"
            )
            : [];
    },

    stop() {
        bookmarks = [];
    }
});
