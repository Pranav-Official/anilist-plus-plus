import type { ReleaseData, ReleaseEntry } from "./seadex_api";

export const SEADEX_PANEL_ID = "seadex-panel";

// ==========================================
// 1. Shared Utilities (DOM, Text, Data)
// ==========================================

// Anchor Finding
export function findAnchor(): HTMLElement | null {
    const mediaRoot = document.querySelector<HTMLElement>(".page-content .media.media-anime");
    if (!mediaRoot) return null;

    const reviews = mediaRoot.querySelector(".reviews");
    if (reviews) {
        const wrapper = reviews.closest<HTMLElement>(".grid-section-wrap");
        if (wrapper) return wrapper;
    }

    const threads = mediaRoot.querySelector(".threads");
    if (threads) {
        const wrapper = threads.closest<HTMLElement>(".grid-section-wrap");
        if (wrapper) return wrapper;
    }

    return null;
}

export function provisionalContainer(): HTMLElement | null {
    return document.querySelector<HTMLElement>(".page-content .media.media-anime");
}

function appendTextWithLineBreaks(parent: HTMLElement, text: string): void {
    const lines = text.split(/\n+/);
    lines.forEach((line, index) => {
        parent.appendChild(document.createTextNode(line));
        if (index < lines.length - 1) {
            parent.appendChild(document.createElement("br"));
        }
    });
}

function appendLinkifiedComparison(parent: HTMLElement, text: string): void {
    const lines = text.split(/\n+/);
    const urlRegex = /(https?:\/\/[^\s,]+)/g;

    lines.forEach((line, lineIndex) => {
        const urls = line.match(urlRegex);
        if (urls && urls.length > 1) {
            urls.forEach((url, urlIndex) => {
                const link = document.createElement("a");
                link.href = url;
                link.textContent = url;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                parent.appendChild(link);
                if (urlIndex < urls.length - 1) {
                    parent.appendChild(document.createElement("br"));
                }
            });
        } else {
            let lastIndex = 0;
            let match;
            const regex = new RegExp(urlRegex);
            while ((match = regex.exec(line)) !== null) {
                if (match.index > lastIndex) {
                    parent.appendChild(document.createTextNode(line.slice(lastIndex, match.index)));
                }
                const link = document.createElement("a");
                link.href = match[0];
                link.textContent = match[0];
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                parent.appendChild(link);
                lastIndex = regex.lastIndex;
            }
            if (lastIndex < line.length) {
                parent.appendChild(document.createTextNode(line.slice(lastIndex)));
            }
        }
        if (lineIndex < lines.length - 1) {
            parent.appendChild(document.createElement("br"));
        }
    });
}

// Data Parsing
const UNIT_MULTIPLIERS: Record<string, number> = {
    "": 1, "BYTES": 1,
    "KIB": 1024, "KB": 1000,
    "MIB": 1024 ** 2, "MB": 1000 ** 2,
    "GIB": 1024 ** 3, "GB": 1000 ** 3,
    "TIB": 1024 ** 4, "TB": 1000 ** 4,
};

function parseFileSize(sizeStr: string | undefined): number {
    if (!sizeStr) return 0;
    const match = sizeStr.match(/^([\d.]+)\s*(bytes|[KMGT]iB|[KMGT]B)?$/i);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = (match[2] || "").toUpperCase();
    return value * (UNIT_MULTIPLIERS[unit] || 1);
}

// ==========================================
// 2. UI Component Helpers
// ==========================================

const BASE_BTN_STYLE = "border: none; cursor: pointer; font-size: 1.1em; padding: 0.35rem 0.5rem; border-radius: 4px; color: white;";
const FLEX_COLUMN_GAP_HALF = "display: flex; flex-direction: column; gap: 0.5rem;";
const FLEX_COLUMN_GAP_ONE = "display: flex; flex-direction: column; gap: 1rem;";
const FLEX_ROW_WRAP = "display: flex; gap: 1.5rem; flex-wrap: wrap;";

function createCardContainer(): HTMLElement {
    const card = document.createElement("div");
    card.className = "result-card";
    card.style.cssText = `
        border: 1px solid rgba(var(--color-foreground-rgb, 92,114,138), 0.3);
        border-radius: 6px;
        overflow: hidden;
        transition: all 0.2s ease;
    `;
    return card;
}

function createCardHeader(): HTMLElement {
    const header = document.createElement("div");
    header.className = "card-header";
    header.style.cssText = `
        display: flex;
        align-items: center;
        padding: 0.75rem 1rem;
        gap: 0.75rem;
        background: rgba(var(--color-foreground-rgb, 92,114,138), 0.05);
        cursor: pointer;
    `;
    return header;
}

function createTitleContainer(text: string, tooltip: string = ""): HTMLElement {
    const container = document.createElement("div");
    container.style.cssText = "flex: 1; display: flex; align-items: center; overflow: hidden; gap: 0.5rem;";

    const titleSpan = document.createElement("span");
    titleSpan.style.cssText = "font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; max-width: 80%;";
    titleSpan.textContent = text;
    titleSpan.title = tooltip || text;

    container.appendChild(titleSpan);
    return container;
}

function createSimpleTitle(text: string): HTMLElement {
    const title = document.createElement("span");
    title.style.cssText = "flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
    title.textContent = text;
    title.title = text;
    return title;
}

function createActionContainer(): HTMLElement {
    const container = document.createElement("div");
    container.style.cssText = "display: flex; align-items: center; gap: 0.75rem; margin-left: auto; flex-shrink: 0;";
    return container;
}

function createExpandButton(): HTMLElement {
    const expandBtn = document.createElement("span");
    expandBtn.className = "expand-btn";
    expandBtn.textContent = "+";
    expandBtn.style.cssText = `
        font-size: 1.4em;
        font-weight: 600;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        background: rgba(var(--color-foreground-rgb, 92,114,138), 0.1);
    `;
    return expandBtn;
}

function createActionButton(icon: string, title: string, color: string, onClick?: (ev: MouseEvent) => void): HTMLElement {
    const btn = document.createElement("button");
    btn.textContent = icon;
    btn.title = title;
    btn.style.cssText = `background: ${color}; ${BASE_BTN_STYLE}`;
    if (onClick) {
        btn.addEventListener("click", onClick);
    }
    return btn;
}

function createLinkButton(icon: string, title: string, url: string, color: string): HTMLElement {
    const link = document.createElement("a");
    link.textContent = icon;
    link.title = title;
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.style.cssText = `background: ${color}; text-decoration: none; display: inline-block; ${BASE_BTN_STYLE}`;
    link.addEventListener("click", (ev) => ev.stopPropagation());
    return link;
}

function createDetailSpan(label: string, value: string, color?: string): HTMLElement {
    const span = document.createElement("span");
    if (color) span.style.color = color;

    const strong = document.createElement("strong");
    strong.textContent = label;

    span.appendChild(strong);
    span.appendChild(document.createTextNode(" " + value));
    return span;
}

function createDetailsContainer(): HTMLElement {
    const details = document.createElement("div");
    details.className = "card-details";
    details.style.cssText = "display: none; padding: 0.75rem 1rem; border-top: 1px solid rgba(var(--color-foreground-rgb, 92,114,138), 0.2); font-size: 0.9em;";
    return details;
}

// ==========================================
// 3. Panel Placement Helper
// ==========================================

function placePanel(
    panelId: string,
    anilistId: number,
    content: HTMLElement | null,
    afterElementId?: string
): void {
    const existing = document.getElementById(panelId);
    if (!existing) {
        // Create new panel
        if (!content) return; // Should not happen if creating
        const panel = document.createElement("div");
        panel.id = panelId;
        panel.className = "grid-section-wrap";
        panel.dataset.anilistId = String(anilistId);
        panel.dataset.anchored = "false";

        const inner = document.createElement("div");
        inner.className = "section";
        inner.appendChild(content);
        panel.appendChild(inner);

        insertPanel(panel, afterElementId);
        return;
    }

    // Refresh existing placement
    if (existing.dataset.anilistId && existing.dataset.anilistId !== String(anilistId)) {
        return; // Don't touch if belonging to another ID (handled by tryInject)
    }

    insertPanel(existing, afterElementId);
}

function insertPanel(panel: HTMLElement, afterElementId?: string): void {
    const anchor = findAnchor();
    const provisional = provisionalContainer();

    let target: Element | null = null;
    if (afterElementId) {
        target = document.getElementById(afterElementId);
    }

    // If target exists and is attached, place after it
    if (target && target.parentElement) {
        panel.style.marginTop = "2rem";
        // Only move if not already there
        if (panel.previousElementSibling !== target) {
            target.insertAdjacentElement("afterend", panel);
        }
        panel.dataset.anchored = "true";
        return;
    }

    // Fallback to anchor
    if (anchor && anchor.parentElement) {
        panel.style.marginTop = "";
        if (panel.previousElementSibling !== anchor) {
            anchor.insertAdjacentElement("afterend", panel);
        }
        panel.dataset.anchored = "true";
        return;
    }

    // Fallback to provisional
    if (provisional && (!panel.parentElement || panel.parentElement !== provisional)) {
        provisional.appendChild(panel);
    }
}

// ==========================================
// 4. SeaDex Panel Logic
// ==========================================

export function renderSeadexPanel(data: ReleaseData, anilistId: number): void {
    const content = document.createElement("div");

    const header = document.createElement("h2");
    header.textContent = "Seadex Releases";
    header.className = "section-header";
    content.appendChild(header);

    const contentWrap = document.createElement("div");
    contentWrap.className = "content-wrap list";
    contentWrap.style.cssText = FLEX_COLUMN_GAP_ONE;

    // Display Meta Info
    const metaContainer = document.createElement("div");
    metaContainer.style.cssText = `${FLEX_COLUMN_GAP_HALF} margin-bottom: 1rem;`;

    if (data.comparison) {
        metaContainer.appendChild(createMetaCard("Comparison", data.comparison, true));
    }
    if (data.notes) {
        metaContainer.appendChild(createMetaCard("Notes", data.notes));
    }
    if (data.theoreticalBest) {
        metaContainer.appendChild(createMetaCard("Theoretical Best", data.theoreticalBest));
    }
    contentWrap.appendChild(metaContainer);

    // Display Releases
    const resultsContainer = document.createElement("div");
    resultsContainer.style.cssText = FLEX_COLUMN_GAP_HALF;

    data.releases.forEach((release: ReleaseEntry) => {
        resultsContainer.appendChild(createSeadexCard(release));
    });

    contentWrap.appendChild(resultsContainer);
    content.appendChild(contentWrap);

    // Mount
    placePanel(SEADEX_PANEL_ID, anilistId, content);
}

export function ensureSeadexPanelPlacement(currentAniId: number | null): void {
    const seadexPanel = document.getElementById(SEADEX_PANEL_ID);
    if (!seadexPanel || !currentAniId) return;
    insertPanel(seadexPanel);
}

function createMetaCard(title: string, contentText: string, isComparison: boolean = false): HTMLElement {
    const card = createCardContainer();
    card.className = "seadex-meta-card";
    card.style.background = "rgba(var(--color-background-rgb), 0.6)";

    const header = createCardHeader();

    const titleSpan = document.createElement("span");
    titleSpan.style.cssText = "flex: 1; font-weight: 600;";
    titleSpan.textContent = title;

    const expandBtn = createExpandButton();
    expandBtn.textContent = "-";

    header.appendChild(titleSpan);
    header.appendChild(expandBtn);

    const contentDiv = document.createElement("div");
    contentDiv.style.cssText = "display: block; padding: 1rem; border-top: 1px solid rgba(var(--color-foreground-rgb, 92,114,138), 0.2); font-size: 0.9em; line-height: 1.5;";

    if (isComparison) {
        appendLinkifiedComparison(contentDiv, contentText);
    } else {
        appendTextWithLineBreaks(contentDiv, contentText);
    }

    header.addEventListener("click", () => {
        const isHidden = contentDiv.style.display === "none";
        contentDiv.style.display = isHidden ? "block" : "none";
        expandBtn.textContent = isHidden ? "-" : "+";
    });

    card.appendChild(header);
    card.appendChild(contentDiv);
    return card;
}

function createSeadexCard(release: ReleaseEntry): HTMLElement {
    const card = createCardContainer();
    card.className = "seadex-result-card";

    const header = createCardHeader();

    // Release Group
    const titleContainer = createTitleContainer(release.releaseGroup || "Unknown Group", release.releaseGroup);

    // Flags
    const allFlags: string[] = [];
    if (release.dualAudio) allFlags.push("Dual Audio");
    if (release.isBest) allFlags.push("Best Release");
    if (release.privateTracker) allFlags.push("Private Tracker");
    if (release.tags && release.tags.length > 0) {
        allFlags.push(...release.tags);
    }

    if (allFlags.length > 0) {
        const flagsSpan = document.createElement("span");
        flagsSpan.style.cssText = "font-size: 0.85em; color: #3fa9f5; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 1; min-width: 0;";
        flagsSpan.textContent = allFlags.join(" • ");
        flagsSpan.title = allFlags.join(" • ");
        titleContainer.appendChild(flagsSpan);
    }

    const actionsContainer = createActionContainer();

    const trackerSpan = document.createElement("span");
    trackerSpan.style.cssText = "margin-right: 0.5rem; font-weight: 600;";
    trackerSpan.textContent = release.tracker || "";
    trackerSpan.title = release.tracker || "";
    if (release.tracker) actionsContainer.appendChild(trackerSpan);

    const sizeSpan = document.createElement("span");
    sizeSpan.style.cssText = "color: #68D639; font-weight: 600; min-width: 80px; text-align: right; margin-right: 0.5rem;";
    sizeSpan.textContent = release.fileSize || "";
    actionsContainer.appendChild(sizeSpan);

    const rawUrl = release.url || "";
    if (rawUrl) {
        if (/^https?:\/\//i.test(rawUrl)) {
            const urlBtn = createLinkButton("🔗", "Open URL", rawUrl, "#02A9FF");
            actionsContainer.appendChild(urlBtn);
        } else {
            const copyBtn = createActionButton("🔒", "Copy Private Tracker Path", "#02A9FF", async (ev) => {
                ev.stopPropagation();
                try {
                    await navigator.clipboard.writeText(rawUrl);
                    copyBtn.textContent = "✓";
                    setTimeout(() => { copyBtn.textContent = "🔒"; }, 1000);
                } catch {
                    window.prompt("Copy URL", rawUrl);
                }
            });
            actionsContainer.appendChild(copyBtn);
        }
    }

    const expandBtn = createExpandButton();
    actionsContainer.appendChild(expandBtn);

    header.appendChild(titleContainer);
    header.appendChild(actionsContainer);

    const details = createDetailsContainer();

    if (release.episodeList?.length) {
        const episodesHeader = document.createElement("div");
        episodesHeader.textContent = "Episodes:";
        episodesHeader.style.cssText = "font-weight: 600; margin-bottom: 0.5rem; margin-top: 0.5rem;";
        details.appendChild(episodesHeader);

        const episodeList = document.createElement("ul");
        episodeList.style.cssText = "list-style: none; padding-left: 0.5rem; margin: 0;";

        release.episodeList.forEach((ep) => {
            const li = document.createElement("li");
            li.style.cssText = "padding: 0.25rem 0; border-bottom: 1px solid rgba(var(--color-foreground-rgb, 92,114,138), 0.1); display: flex; justify-content: space-between;";

            const nameSpan = document.createElement("span");
            nameSpan.textContent = `📄 ${ep.name || "Unknown Episode"}`;

            const sizeSize = document.createElement("span");
            sizeSize.textContent = ep.size || "";
            sizeSize.style.opacity = "0.8";

            li.appendChild(nameSpan);
            li.appendChild(sizeSize);
            episodeList.appendChild(li);
        });
        details.appendChild(episodeList);
    }

    card.appendChild(header);
    card.appendChild(details);

    header.addEventListener("click", () => {
        const isHidden = details.style.display === "none";
        details.style.display = isHidden ? "block" : "none";
        expandBtn.textContent = isHidden ? "-" : "+";
    });

    return card;
}


