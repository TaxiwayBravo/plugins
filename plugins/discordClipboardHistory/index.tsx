import "./styles.css";

import { ApplicationCommandInputType } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import definePlugin from "@utils/types";
import { ConfirmModal, openModal, React, showToast, Text, Toasts } from "@webpack/common";

const STORE_KEY = "TaxiwayBravo_DiscordClipboardHistory_v1";
const MAX_ITEMS = 100;
interface ClipboardItem { id: string; text: string; source: string; timestamp: number; copies: number; }
let items: ClipboardItem[] = [];
let originalWriteText: ((text: string) => Promise<void>) | null = null;
let clipboardWrapper: ((text: string) => Promise<void>) | null = null;
let suppressCapture = false;

function save() { void DataStore.set(STORE_KEY, items); }
function addItem(text: string, source = "Discord") {
    const cleaned = String(text ?? "").trim();
    if (!cleaned || suppressCapture) return;
    const previous = items[0];
    if (previous?.text === cleaned) items = [{ ...previous, timestamp: Date.now(), copies: previous.copies + 1, source }, ...items.slice(1)];
    else items = [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: cleaned, source, timestamp: Date.now(), copies: 1 }, ...items].slice(0, MAX_ITEMS);
    save();
}
async function writeWithoutCapture(text: string) {
    try { suppressCapture = true; if (originalWriteText) await originalWriteText(text); else await navigator.clipboard.writeText(text); showToast("Copied", Toasts.Type.SUCCESS); }
    catch { showToast("Could not access the clipboard", Toasts.Type.FAILURE); }
    finally { suppressCapture = false; }
}
function shortText(text: string) { const single = text.replace(/\s+/g, " "); return single.length > 180 ? `${single.slice(0, 177)}…` : single; }
function HistoryRow({ item, remove }: { item: ClipboardItem; remove: (id: string) => void; }) {
    return <div className="tb-clip-row"><div className="tb-clip-copy"><Text variant="text-sm/normal" className="tb-clip-value">{shortText(item.text)}</Text><Text variant="text-xs/normal" className="tb-clip-meta">{item.source} · {new Date(item.timestamp).toLocaleString()}{item.copies > 1 ? ` · copied ${item.copies}×` : ""}</Text></div><div className="tb-clip-actions"><button type="button" onClick={() => void writeWithoutCapture(item.text)}>Copy</button><button type="button" className="danger" onClick={() => remove(item.id)}>Remove</button></div></div>;
}
function ClipboardHistoryModal(props: Record<string, any>) {
    const [current, setCurrent] = React.useState(() => items.slice());
    function remove(id: string) { items = items.filter(item => item.id !== id); setCurrent(items.slice()); save(); }
    function clear() { items = []; setCurrent([]); save(); }
    return <ConfirmModal {...props} title={`Discord Clipboard History — ${current.length}`} confirmText="Close" cancelText="Close" onConfirm={() => { }}><div className="tb-clip-root"><div className="tb-clip-toolbar"><Text variant="text-sm/normal" className="tb-clip-meta">Stores up to {MAX_ITEMS} copied text entries locally.</Text><button type="button" className="tb-clip-clear" disabled={current.length === 0} onClick={clear}>Clear all</button></div>{current.length === 0 ? <div className="tb-clip-empty"><Text variant="text-md/normal">Nothing copied in Discord yet.</Text></div> : <div className="tb-clip-list">{current.map(item => <HistoryRow key={item.id} item={item} remove={remove} />)}</div>}</div></ConfirmModal>;
}
function openHistory() { openModal(props => <ClipboardHistoryModal {...props} />); }
function onTaxiwayCopy(event: Event) { const detail = (event as CustomEvent).detail; if (detail?.text) addItem(detail.text, detail.source ?? "TaxiwayBravo"); }
function onDocumentCopy() { window.setTimeout(() => { const selected = window.getSelection()?.toString(); if (selected) addItem(selected, "Discord selection"); }, 0); }
function installWrapper() {
    try {
        if (!navigator.clipboard?.writeText) return;
        originalWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
        clipboardWrapper = async (text: string) => { const result = await originalWriteText!(text); addItem(text, "Discord / Vencord"); return result; };
        navigator.clipboard.writeText = clipboardWrapper;
    } catch { originalWriteText = null; clipboardWrapper = null; }
}
function restoreWrapper() {
    try { if (originalWriteText && clipboardWrapper && navigator.clipboard.writeText === clipboardWrapper) navigator.clipboard.writeText = originalWriteText; } catch { }
    originalWriteText = null; clipboardWrapper = null;
}

export default definePlugin({
    name: "DiscordClipboardHistory",
    description: "Keeps a private local history of text copied while using Discord.",
    authors: [{ name: "TaxiwayBravo", id: 325723086374567938n }],
    tags: ["Utility", "Privacy"],
    commands: [{ inputType: ApplicationCommandInputType.BUILT_IN, name: "clipboardhistory", description: "Open your local Discord clipboard history", execute: () => openHistory() }],
    async start() {
        const stored = await DataStore.get<ClipboardItem[]>(STORE_KEY);
        items = Array.isArray(stored) ? stored.filter(item => item && typeof item.text === "string" && typeof item.timestamp === "number").slice(0, MAX_ITEMS) : [];
        window.addEventListener("TaxiwayBravoClipboardCopy", onTaxiwayCopy);
        document.addEventListener("copy", onDocumentCopy, true);
        installWrapper();
    },
    stop() {
        window.removeEventListener("TaxiwayBravoClipboardCopy", onTaxiwayCopy);
        document.removeEventListener("copy", onDocumentCopy, true);
        restoreWrapper(); save();
    }
});
