import type { NyaaMetadata, NyaaFileEntry } from "./nyaa_scraper";
import { AnidbIdApi, type Episode } from "./anidb_id_api";
import { AnilistApi } from "./anilist_api";

// ==========================================
// Types & Interfaces
// ==========================================

interface AnimeInfo {
	episodes: number;
	status: "FINISHED" | "RELEASING" | "NOT_YET_RELEASED" | "CANCELLED" | "HIATUS";
	currentAiringEpisode?: number;
	userWatchedEpisodes?: number;
}

interface NyaaMetadataEnhanced extends NyaaMetadata {
	_parsedSize?: number;
	_parsedDate?: number;
	_parsedSeeders?: number;
	_parsedCompleted?: number;
}

type SortCriteria = 'seeders' | 'date' | 'size' | 'completed';

// ==========================================
// State Management
// ==========================================

const carouselState = {
	cachedEpisodes: null as Episode[] | null,
	cachedAnilistId: null as number | null,
	currentPage: 0,
	itemsPerPage: 12,
	sortCriteria: 'seeders' as SortCriteria,
	abortController: null as AbortController | null,
	results: [] as NyaaMetadataEnhanced[],
};

// ==========================================
// DOM Parsing - Extract Anime Info from AniList
// ==========================================

export function extractAnimeInfoFromDOM(): AnimeInfo | null {
	// Find the data container
	const dataContainer = document.querySelector('.data');
	if (!dataContainer) return null;

	let episodes = 0;
	let status: AnimeInfo['status'] = 'NOT_YET_RELEASED';
	let currentAiringEpisode: number | undefined;

	// Parse episodes
	const episodesElement = dataContainer.querySelector('.data-set .type');
	dataContainer.querySelectorAll('.data-set').forEach((dataSet) => {
		const typeElement = dataSet.querySelector('.type');
		const valueElement = dataSet.querySelector('.value');
		
		if (typeElement && valueElement) {
			const typeText = typeElement.textContent?.trim();
			const valueText = valueElement.textContent?.trim();

			if (typeText === 'Episodes' && valueText) {
				const parsed = parseInt(valueText, 10);
				if (!isNaN(parsed)) episodes = parsed;
			}

			if (typeText === 'Status' && valueText) {
				const normalized = valueText.toUpperCase().replace(/\s+/g, '_');
				if (['FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS'].includes(normalized)) {
					status = normalized as AnimeInfo['status'];
				}
			}
		}
	});

	// Check for airing countdown to get current episode
	const airingElement = dataContainer.querySelector('.data-set.airing-countdown .countdown');
	if (airingElement) {
		const text = airingElement.textContent || '';
		const match = text.match(/Ep\s*(\d+)/i);
		if (match) {
			currentAiringEpisode = parseInt(match[1], 10);
		}
	}

	// Try to find user's watched episode progress
	let userWatchedEpisodes: number | undefined;
	
	// Look for progress in the actions/list area
	const actionsContainer = document.querySelector('.actions');
	if (actionsContainer) {
		// Check for progress text like "4/12" or similar patterns
		const progressText = actionsContainer.textContent || '';
		const progressMatch = progressText.match(/(\d+)\s*\/\s*(\d+)/);
		if (progressMatch) {
			userWatchedEpisodes = parseInt(progressMatch[1], 10);
		}
	}

	if (episodes === 0 && status !== 'NOT_YET_RELEASED') {
		// If no episodes found but status is not "not yet released", might be a movie or special
		// Set episodes to 1 for those cases
		episodes = 1;
	}

	return { episodes, status, currentAiringEpisode, userWatchedEpisodes };
}

function calculateAvailableEpisodes(info: AnimeInfo): number {
	if (info.status === 'FINISHED') {
		return info.episodes;
	} else if (info.status === 'RELEASING' && info.currentAiringEpisode) {
		// Return episodes up to (current - 1) since current is still airing
		return Math.max(0, info.currentAiringEpisode - 1);
	}
	return 0;
}

// ==========================================
// Episode Data Loading
// ==========================================

async function loadEpisodeTitles(anilistId: number): Promise<Map<number, string>> {
	if (carouselState.cachedEpisodes && carouselState.cachedAnilistId === anilistId) {
		const map = new Map<number, string>();
		carouselState.cachedEpisodes.forEach((ep) => {
			const epNum = parseInt(ep.episode, 10);
			if (!isNaN(epNum)) {
				map.set(epNum, ep.title);
			}
		});
		return map;
	}

	const api = new AnidbIdApi();
	const result = await api.getAnidbId(anilistId);
	const map = new Map<number, string>();

	if (result && result.episodes) {
		carouselState.cachedEpisodes = result.episodes;
		carouselState.cachedAnilistId = anilistId;

		result.episodes.forEach((ep) => {
			const epNum = parseInt(ep.episode, 10);
			if (!isNaN(epNum)) {
				map.set(epNum, ep.title);
			}
		});
	}

	return map;
}

// ==========================================
// Carousel UI Components
// ==========================================

const CAROUSEL_ID = 'episode-carousel';
const MODAL_ID = 'episode-results-modal';
const MODAL_OVERLAY_ID = 'episode-results-overlay';

export async function injectEpisodeCarousel(anilistId: number): Promise<void> {
	const animeInfo = extractAnimeInfoFromDOM();
	if (!animeInfo || animeInfo.episodes === 0) {
		console.log('EpisodeCarousel: No episode info found');
		return;
	}

	const availableEpisodes = calculateAvailableEpisodes(animeInfo);
	if (availableEpisodes === 0) {
		console.log('EpisodeCarousel: No episodes available yet');
		return;
	}

	// Fetch user progress first to determine if we need to recreate
	const anilistApi = new AnilistApi();
	const userProgress = await anilistApi.getUserProgress(anilistId);
	
	// Remove existing carousel if it exists for a different anime or data changed
	const existing = document.getElementById(CAROUSEL_ID);
	if (existing) {
		if (existing.dataset.anilistId !== String(anilistId)) {
			// Different anime, remove it
			existing.remove();
		} else if (existing.dataset.totalEpisodes !== String(availableEpisodes)) {
			// Same anime but episode count changed, update it
			console.log(`EpisodeCarousel: Episode count changed from ${existing.dataset.totalEpisodes} to ${availableEpisodes}, updating...`);
			existing.remove();
		} else if (existing.dataset.userProgress !== String(userProgress ?? '')) {
			// Same anime but user progress changed, update it
			console.log(`EpisodeCarousel: User progress changed from ${existing.dataset.userProgress} to ${userProgress}, updating...`);
			existing.remove();
		} else {
			// Same anime, same data, don't recreate
			return;
		}
	}

	// Create carousel container
	const carousel = document.createElement('div');
	carousel.id = CAROUSEL_ID;
	carousel.dataset.anilistId = String(anilistId);
	carousel.dataset.totalEpisodes = String(availableEpisodes);
	carousel.dataset.userProgress = String(userProgress ?? '');
	carousel.style.cssText = `
		margin: 1.5rem 0;
		padding: 1rem 0;
		border-top: 1px solid rgba(var(--color-foreground-rgb, 92,114,138), 0.1);
		border-bottom: 1px solid rgba(var(--color-foreground-rgb, 92,114,138), 0.1);
	`;

	// Header
	const header = document.createElement('div');
	header.style.cssText = `
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	`;

	const title = document.createElement('h3');
	title.textContent = 'Episodes';
	title.style.cssText = `
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
		color: rgb(var(--color-foreground-rgb, 92,114,138));
	`;

	header.appendChild(title);
	carousel.appendChild(header);

	// Grid container
	const gridContainer = document.createElement('div');
	gridContainer.id = 'episode-grid';
	gridContainer.style.cssText = `
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 0.75rem;
		margin-bottom: 1rem;
		
		@media (max-width: 1200px) {
			grid-template-columns: repeat(4, 1fr);
		}
		
		@media (max-width: 900px) {
			grid-template-columns: repeat(3, 1fr);
		}
		
		@media (max-width: 600px) {
			grid-template-columns: repeat(2, 1fr);
		}
	`;

	carousel.appendChild(gridContainer);

	// Pagination controls
	const pagination = document.createElement('div');
	pagination.id = 'episode-pagination';
	pagination.style.cssText = `
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 1rem;
		margin-top: 1rem;
	`;

	const prevBtn = createPaginationButton('Previous', () => changePage(-1, availableEpisodes));
	const pageInfo = document.createElement('span');
	pageInfo.id = 'episode-page-info';
	pageInfo.style.cssText = 'font-size: 0.9em; color: rgba(var(--color-foreground-rgb, 92,114,138), 0.8);';
	const nextBtn = createPaginationButton('Next', () => changePage(1, availableEpisodes));

	pagination.appendChild(prevBtn);
	pagination.appendChild(pageInfo);
	pagination.appendChild(nextBtn);
	carousel.appendChild(pagination);

	// Find insertion point - between description and nav
	const contentDiv = document.querySelector('.page-content .media.media-anime .content');
	if (!contentDiv) {
		console.log('EpisodeCarousel: Could not find content container');
		return;
	}

	const description = contentDiv.querySelector('.description');
	const nav = contentDiv.querySelector('.nav');

	if (description && nav) {
		nav.insertAdjacentElement('beforebegin', carousel);
	} else if (nav) {
		nav.insertAdjacentElement('beforebegin', carousel);
	} else {
		contentDiv.appendChild(carousel);
	}

	// Load episode titles and render
	loadEpisodeTitles(anilistId).then((titles) => {
		renderEpisodePage(availableEpisodes, titles, 0, anilistId, userProgress);
	});
}

function createPaginationButton(text: string, onClick: () => void): HTMLButtonElement {
	const btn = document.createElement('button');
	btn.textContent = text;
	btn.className = 'button';
	btn.style.cssText = `
		padding: 0.5rem 1rem;
		cursor: pointer;
		background: rgba(var(--color-foreground-rgb, 92,114,138), 0.1);
		border: none;
		border-radius: 4px;
		color: rgb(var(--color-foreground-rgb, 92,114,138));
		font-size: 0.9em;
		transition: background 0.2s;
	`;
	btn.addEventListener('mouseenter', () => {
		btn.style.background = 'rgba(var(--color-foreground-rgb, 92,114,138), 0.2)';
	});
	btn.addEventListener('mouseleave', () => {
		btn.style.background = 'rgba(var(--color-foreground-rgb, 92,114,138), 0.1)';
	});
	btn.addEventListener('click', onClick);
	return btn;
}

function changePage(direction: number, totalEpisodes: number): void {
	const newPage = carouselState.currentPage + direction;
	const maxPage = Math.ceil(totalEpisodes / carouselState.itemsPerPage) - 1;

	if (newPage < 0 || newPage > maxPage) return;

	carouselState.currentPage = newPage;

	const anilistId = parseInt(document.getElementById(CAROUSEL_ID)?.dataset.anilistId || '0', 10);
	const anilistApi = new AnilistApi();
	
	Promise.all([
		loadEpisodeTitles(anilistId),
		anilistApi.getUserProgress(anilistId)
	]).then(([titles, userProgress]) => {
		renderEpisodePage(totalEpisodes, titles, newPage, anilistId, userProgress);
	});
}

function renderEpisodePage(
	totalEpisodes: number,
	titles: Map<number, string>,
	page: number,
	anilistId: number,
	userWatchedEpisodes?: number | null
): void {
	const grid = document.getElementById('episode-grid');
	const pageInfo = document.getElementById('episode-page-info');
	if (!grid || !pageInfo) return;

	const start = page * carouselState.itemsPerPage;
	const end = Math.min(start + carouselState.itemsPerPage, totalEpisodes);
	const maxPage = Math.ceil(totalEpisodes / carouselState.itemsPerPage);

	pageInfo.textContent = `Page ${page + 1} of ${maxPage}`;

	// Clear grid
	grid.innerHTML = '';

	// Create episode cards
	for (let i = start; i < end; i++) {
		const episodeNum = i + 1;
		const title = titles.get(episodeNum) || '';
		const isWatched = userWatchedEpisodes !== null && userWatchedEpisodes !== undefined && episodeNum <= userWatchedEpisodes;
		const card = createEpisodeCard(episodeNum, title, anilistId, isWatched);
		grid.appendChild(card);
	}

	// Update pagination button states
	const carousel = document.getElementById(CAROUSEL_ID);
	if (carousel) {
		const buttons = carousel.querySelectorAll('button');
		if (buttons.length >= 2) {
			buttons[0].disabled = page === 0;
			buttons[0].style.opacity = page === 0 ? '0.5' : '1';
			buttons[0].style.cursor = page === 0 ? 'not-allowed' : 'pointer';

			buttons[buttons.length - 1].disabled = page >= maxPage - 1;
			buttons[buttons.length - 1].style.opacity = page >= maxPage - 1 ? '0.5' : '1';
			buttons[buttons.length - 1].style.cursor = page >= maxPage - 1 ? 'not-allowed' : 'pointer';
		}
	}
}

function createEpisodeCard(episodeNum: number, title: string, anilistId: number, isWatched: boolean = false): HTMLElement {
	const card = document.createElement('div');
	card.className = 'episode-card';
	
	// Use muted green border if watched, otherwise default
	const borderColor = isWatched ? '#7CB342' : 'rgba(var(--color-foreground-rgb, 92,114,138), 0.15)';
	const borderWidth = isWatched ? '2px' : '1px';
	
	card.style.cssText = `
		background: rgba(var(--color-foreground-rgb, 92,114,138), 0.05);
		border: ${borderWidth} solid ${borderColor};
		border-radius: 8px;
		padding: 1rem;
		cursor: pointer;
		transition: all 0.2s ease;
		text-align: center;
		position: relative;
		overflow: hidden;
		min-height: 80px;
		display: flex;
		flex-direction: column;
		justify-content: center;
	`;

	const epNumber = document.createElement('div');
	epNumber.textContent = String(episodeNum);
	epNumber.style.cssText = `
		font-size: 2rem;
		font-weight: 700;
		color: #02A9FF;
		margin-bottom: 0.5rem;
		line-height: 1;
	`;

	card.appendChild(epNumber);

	if (title) {
		const epTitle = document.createElement('div');
		epTitle.textContent = title;
		epTitle.style.cssText = `
			font-size: 0.85rem;
			color: rgba(var(--color-foreground-rgb, 92,114,138), 0.85);
			overflow: hidden;
			text-overflow: ellipsis;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			-webkit-box-orient: vertical;
			line-height: 1.3;
			max-height: 2.6em;
		`;
		epTitle.title = title;
		card.appendChild(epTitle);
	}

	// Add checkmark for watched episodes
	if (isWatched) {
		const checkmark = document.createElement('div');
		checkmark.textContent = '✓';
		checkmark.style.cssText = `
			position: absolute;
			bottom: 4px;
			right: 4px;
			width: 20px;
			height: 20px;
			background: #7CB342;
			color: white;
			border-radius: 50%;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 12px;
			font-weight: bold;
		`;
		card.appendChild(checkmark);
	}

	// Hover effects
	card.addEventListener('mouseenter', () => {
		card.style.background = 'rgba(var(--color-foreground-rgb, 92,114,138), 0.1)';
		card.style.borderColor = '#02A9FF';
		card.style.transform = 'translateY(-2px)';
	});

	card.addEventListener('mouseleave', () => {
		card.style.background = 'rgba(var(--color-foreground-rgb, 92,114,138), 0.05)';
		card.style.borderColor = isWatched ? '#7CB342' : 'rgba(var(--color-foreground-rgb, 92,114,138), 0.15)';
		card.style.transform = 'translateY(0)';
	});

	card.addEventListener('click', () => {
		openEpisodeModal(episodeNum, anilistId);
	});

	return card;
}

// ==========================================
// Modal for Episode Results
// ==========================================

function openEpisodeModal(episodeNum: number, anilistId: number): void {
	// Close any existing modal
	closeEpisodeModal();

	// Create overlay
	const overlay = document.createElement('div');
	overlay.id = MODAL_OVERLAY_ID;
	overlay.style.cssText = `
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.7);
		z-index: 9998;
		backdrop-filter: blur(2px);
	`;

	// Create modal
	const modal = document.createElement('div');
	modal.id = MODAL_ID;
	modal.style.cssText = `
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 90%;
		max-width: 800px;
		max-height: 80vh;
		background: rgb(var(--color-background-rgb, 21, 31, 46));
		border: 1px solid rgba(var(--color-foreground-rgb, 92,114,138), 0.2);
		border-radius: 8px;
		z-index: 9999;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	`;

	// Modal header
	const header = document.createElement('div');
	header.style.cssText = `
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		border-bottom: 1px solid rgba(var(--color-foreground-rgb, 92,114,138), 0.2);
	`;

	const title = document.createElement('h3');
	title.textContent = `Episode ${episodeNum} - Torrent Results`;
	title.style.cssText = 'margin: 0; font-size: 1.2rem;';

	const closeBtn = document.createElement('button');
	closeBtn.textContent = '×';
	closeBtn.style.cssText = `
		background: none;
		border: none;
		font-size: 1.5rem;
		cursor: pointer;
		color: rgb(var(--color-foreground-rgb, 92,114,138));
		padding: 0;
		width: 30px;
		height: 30px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		transition: background 0.2s;
	`;
	closeBtn.addEventListener('mouseenter', () => {
		closeBtn.style.background = 'rgba(var(--color-foreground-rgb, 92,114,138), 0.1)';
	});
	closeBtn.addEventListener('mouseleave', () => {
		closeBtn.style.background = 'none';
	});
	closeBtn.addEventListener('click', closeEpisodeModal);

	header.appendChild(title);
	header.appendChild(closeBtn);
	modal.appendChild(header);

	// Controls section
	const controls = document.createElement('div');
	controls.style.cssText = `
		padding: 1rem;
		border-bottom: 1px solid rgba(var(--color-foreground-rgb, 92,114,138), 0.1);
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	`;

	const searchBtn = document.createElement('button');
	searchBtn.id = 'modal-search-btn';
	searchBtn.textContent = 'Search';
	searchBtn.className = 'button';
	searchBtn.style.cssText = `
		padding: 0.5rem 1rem;
		cursor: pointer;
		background: #02A9FF;
		color: white;
		border: none;
		border-radius: 4px;
	`;

	const sortLabel = document.createElement('span');
	sortLabel.textContent = 'Sort:';
	sortLabel.style.cssText = 'margin-left: 1rem; font-size: 0.9em;';

	const createSortBtn = (label: string, criteria: SortCriteria): HTMLButtonElement => {
		const btn = document.createElement('button');
		btn.textContent = label;
		btn.className = 'button';
		btn.dataset.sortCriteria = criteria;
		const isActive = criteria === carouselState.sortCriteria;
		btn.style.cssText = `
			padding: 0.25rem 0.5rem;
			cursor: pointer;
			font-size: 0.85em;
			border-radius: 4px;
			border: none;
			background: ${isActive ? '#02A9FF' : '#58BFF4'};
			color: white;
		`;
		btn.addEventListener('click', () => handleSortChange(criteria));
		return btn;
	};

	controls.appendChild(searchBtn);
	controls.appendChild(sortLabel);
	controls.appendChild(createSortBtn('Seeders', 'seeders'));
	controls.appendChild(createSortBtn('Date', 'date'));
	controls.appendChild(createSortBtn('Size', 'size'));
	controls.appendChild(createSortBtn('Completed', 'completed'));

	modal.appendChild(controls);

	// Results area
	const resultsArea = document.createElement('div');
	resultsArea.id = 'modal-results';
	resultsArea.style.cssText = `
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
	`;

	modal.appendChild(resultsArea);

	document.body.appendChild(overlay);
	document.body.appendChild(modal);

	// Close on overlay click
	overlay.addEventListener('click', closeEpisodeModal);

	// Start search automatically
	searchBtn.addEventListener('click', () => {
		performEpisodeSearch(episodeNum, anilistId, resultsArea, searchBtn);
	});
	performEpisodeSearch(episodeNum, anilistId, resultsArea, searchBtn);
}

export function closeEpisodeModal(): void {
	// Abort any ongoing search
	if (carouselState.abortController) {
		carouselState.abortController.abort();
		carouselState.abortController = null;
	}

	document.getElementById(MODAL_ID)?.remove();
	document.getElementById(MODAL_OVERLAY_ID)?.remove();
}

// ==========================================
// Search Logic (from original Nyaa panel)
// ==========================================

async function performEpisodeSearch(
	episodeNum: number,
	anilistId: number,
	resultsArea: HTMLElement,
	searchBtn: HTMLButtonElement
): Promise<void> {
	// If search is already in progress, stop it
	if (carouselState.abortController) {
		carouselState.abortController.abort();
		carouselState.abortController = null;
		searchBtn.textContent = 'Search';
		return;
	}

	// Reset state and start new search
	carouselState.results = [];
	carouselState.abortController = new AbortController();

	resultsArea.innerHTML = '';

	const statusText = document.createElement('p');
	statusText.id = 'modal-search-status';
	statusText.style.cssText = 'margin: 0 0 1rem 0;';
	statusText.textContent = 'Searching... Found 0 sources';
	resultsArea.appendChild(statusText);

	const resultsContainer = document.createElement('div');
	resultsContainer.id = 'modal-results-list';
	resultsContainer.style.cssText = `
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	`;
	resultsArea.appendChild(resultsContainer);

	searchBtn.textContent = 'Stop';

	try {
		const api = new AnidbIdApi();
		const generator = api.streamNyaaAnidbEpisodeMetadata(
			anilistId,
			String(episodeNum),
			carouselState.abortController.signal
		);

		for await (const result of generator) {
			if (carouselState.abortController?.signal.aborted) break;

			const enhancedResult = result as NyaaMetadataEnhanced;
			enhancedResult._parsedSize = parseFileSize(enhancedResult.fileSize);
			enhancedResult._parsedDate = new Date(enhancedResult.date || '1970-01-01').getTime();
			enhancedResult._parsedSeeders = parseInt(enhancedResult.seeders || '0');
			enhancedResult._parsedCompleted = parseInt(enhancedResult.completed || '0');

			const resultIndex = carouselState.results.length;
			carouselState.results.push(enhancedResult);

			const card = createResultCard(enhancedResult, resultIndex);
			const insertPos = getInsertPosition(resultsContainer, enhancedResult, carouselState.sortCriteria);

			if (insertPos >= resultsContainer.children.length) {
				resultsContainer.appendChild(card);
			} else {
				resultsContainer.insertBefore(card, resultsContainer.children[insertPos]);
			}

			statusText.textContent = `Searching... Found ${carouselState.results.length} sources`;
		}

		if (carouselState.results.length === 0) {
			statusText.textContent = 'No releases found with active seeders';
		} else {
			statusText.textContent = `Found ${carouselState.results.length} sources`;
		}
	} catch (error) {
		if ((error as Error).name !== 'AbortError') {
			console.error('Search error:', error);
			statusText.textContent = 'Error searching for releases';
			statusText.style.color = '#E85D75';
		}
	} finally {
		carouselState.abortController = null;
		searchBtn.textContent = 'Search';
	}
}

// ==========================================
// Result Cards (from original Nyaa panel)
// ==========================================

function createResultCard(release: NyaaMetadataEnhanced, index: number): HTMLElement {
	const card = document.createElement('div');
	card.className = 'result-card';
	card.dataset.resultIndex = String(index);
	card.style.cssText = `
		border: 1px solid rgba(var(--color-foreground-rgb, 92,114,138), 0.3);
		border-radius: 6px;
		overflow: hidden;
		transition: all 0.2s ease;
	`;

	const header = document.createElement('div');
	header.style.cssText = `
		display: flex;
		align-items: center;
		padding: 0.75rem 1rem;
		gap: 0.75rem;
		background: rgba(var(--color-foreground-rgb, 92,114,138), 0.05);
		cursor: pointer;
	`;

	const title = document.createElement('span');
	title.style.cssText = `
		flex: 1;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	`;
	title.textContent = release.releaseName || 'Unknown Release';
	title.title = release.releaseName || 'Unknown Release';

	const actionsContainer = document.createElement('div');
	actionsContainer.style.cssText = `
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-left: auto;
		flex-shrink: 0;
	`;

	const seedersSpan = document.createElement('span');
	seedersSpan.style.cssText = 'color: #68D639; font-weight: 600; min-width: 90px; text-align: right; margin-right: 0.5rem;';
	seedersSpan.textContent = `${release.seeders || '0'} Seeders`;
	actionsContainer.appendChild(seedersSpan);

	const createActionButton = (icon: string, title: string, color: string, onClick?: (ev: MouseEvent) => void): HTMLElement => {
		const btn = document.createElement('button');
		btn.textContent = icon;
		btn.title = title;
		btn.style.cssText = `
			background: ${color};
			border: none;
			cursor: pointer;
			font-size: 1.1em;
			padding: 0.35rem 0.5rem;
			border-radius: 4px;
			color: white;
		`;
		if (onClick) {
			btn.addEventListener('click', onClick);
		}
		return btn;
	};

	const createLinkButton = (icon: string, title: string, url: string, color: string): HTMLElement => {
		const link = document.createElement('a');
		link.textContent = icon;
		link.title = title;
		link.href = url;
		link.target = '_blank';
		link.rel = 'noopener noreferrer';
		link.style.cssText = `
			background: ${color};
			text-decoration: none;
			display: inline-block;
			border: none;
			cursor: pointer;
			font-size: 1.1em;
			padding: 0.35rem 0.5rem;
			border-radius: 4px;
			color: white;
		`;
		link.addEventListener('click', (ev) => ev.stopPropagation());
		return link;
	};

	const openMagnetBtn = createActionButton('🧲', 'Open Magnet Link', '#02A9FF', (ev) => {
		ev.stopPropagation();
		window.location.href = release.magnet;
	});
	actionsContainer.appendChild(openMagnetBtn);

	const copyMagnetBtn = createActionButton('📋', 'Copy Magnet Link', '#02A9FF', async (ev) => {
		ev.stopPropagation();
		try {
			await navigator.clipboard.writeText(release.magnet);
			copyMagnetBtn.innerHTML = '✓';
			setTimeout(() => { copyMagnetBtn.innerHTML = '📋'; }, 1000);
		} catch {
			window.prompt('Copy Magnet Link', release.magnet);
		}
	});
	actionsContainer.appendChild(copyMagnetBtn);

	const urlBtn = createLinkButton('🔗', 'Open URL', release.url || '#', '#02A9FF');
	actionsContainer.appendChild(urlBtn);

	const expandBtn = document.createElement('span');
	expandBtn.textContent = '+';
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
	actionsContainer.appendChild(expandBtn);

	header.appendChild(title);
	header.appendChild(actionsContainer);

	const details = document.createElement('div');
	details.style.cssText = `
		display: none;
		padding: 0.75rem 1rem;
		border-top: 1px solid rgba(var(--color-foreground-rgb, 92,114,138), 0.2);
		font-size: 0.9em;
	`;

	const fullTitleDiv = document.createElement('div');
	fullTitleDiv.style.cssText = 'font-weight: 600; margin-bottom: 0.75rem; word-break: break-word;';
	fullTitleDiv.textContent = release.releaseName || 'Unknown Release';
	details.appendChild(fullTitleDiv);

	const createDetailSpan = (label: string, value: string, color?: string): HTMLElement => {
		const span = document.createElement('span');
		if (color) span.style.color = color;

		const strong = document.createElement('strong');
		strong.textContent = label;

		span.appendChild(strong);
		span.appendChild(document.createTextNode(' ' + value));
		return span;
	};

	const detailsRow1 = document.createElement('div');
	detailsRow1.style.cssText = `
		display: flex;
		gap: 1.5rem;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	`;
	detailsRow1.appendChild(createDetailSpan('Category:', release.category || 'Unknown'));
	detailsRow1.appendChild(createDetailSpan('Seeders:', release.seeders || '0', '#68D639'));
	detailsRow1.appendChild(createDetailSpan('Leechers:', release.leechers || '0', '#E85D75'));

	const detailsRow2 = document.createElement('div');
	detailsRow2.style.cssText = `
		display: flex;
		gap: 1.5rem;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	`;
	detailsRow2.appendChild(createDetailSpan('Date:', release.date || 'Unknown'));
	detailsRow2.appendChild(createDetailSpan('Size:', release.fileSize || 'Unknown'));
	detailsRow2.appendChild(createDetailSpan('Completed:', release.completed || '0'));

	const detailsRow3 = document.createElement('div');
	detailsRow3.appendChild(createDetailSpan('Submitter:', release.submitter || 'Unknown'));

	details.appendChild(detailsRow1);
	details.appendChild(detailsRow2);
	details.appendChild(detailsRow3);

	if (release.files && release.files.length > 0) {
		const filesSection = document.createElement('div');
		filesSection.style.cssText = 'margin-top: 0.75rem;';

		const filesToggle = document.createElement('a');
		filesToggle.textContent = '📁 Show Files';
		filesToggle.className = 'link';
		filesToggle.style.cssText = 'cursor: pointer;';

		const filesContainer = document.createElement('div');
		filesContainer.style.cssText = 'display: none; margin-top: 0.5rem;';

		filesToggle.addEventListener('click', (ev) => {
			ev.stopPropagation();
			const isHidden = filesContainer.style.display === 'none';
			filesContainer.style.display = isHidden ? 'block' : 'none';
			filesToggle.textContent = isHidden ? '📁 Hide Files' : '📁 Show Files';
		});

		filesContainer.appendChild(renderFileTree(release.files));
		filesSection.appendChild(filesToggle);
		filesSection.appendChild(filesContainer);
		details.appendChild(filesSection);
	}

	card.appendChild(header);
	card.appendChild(details);

	header.addEventListener('click', () => {
		const isHidden = details.style.display === 'none';
		details.style.display = isHidden ? 'block' : 'none';
		expandBtn.textContent = isHidden ? '-' : '+';
	});

	return card;
}

function renderFileTree(entries: NyaaFileEntry[], depth: number = 0): HTMLUListElement {
	const ul = document.createElement('ul');
	ul.style.cssText = `
		padding-left: ${depth === 0 ? '1rem' : '1.5rem'};
		margin: 0;
		list-style: none;
	`;

	for (const entry of entries) {
		const li = document.createElement('li');
		li.style.cssText = 'margin: 0.25rem 0;';

		if (entry.type === 'folder') {
			li.textContent = `📁 ${entry.name || 'Unnamed Folder'}`;
			if (entry.contents && entry.contents.length > 0) {
				li.appendChild(renderFileTree(entry.contents, depth + 1));
			}
		} else {
			li.textContent = `📄 ${entry.name || 'Unnamed File'}${entry.size ? ` (${entry.size})` : ''}`;
		}

		ul.appendChild(li);
	}

	return ul;
}

// ==========================================
// Sorting Logic
// ==========================================

function compareBySort(a: NyaaMetadataEnhanced, b: NyaaMetadataEnhanced, criteria: SortCriteria): number {
	switch (criteria) {
		case 'seeders':
			return (b._parsedSeeders || 0) - (a._parsedSeeders || 0);
		case 'date':
			return (b._parsedDate || 0) - (a._parsedDate || 0);
		case 'size':
			return (b._parsedSize || 0) - (a._parsedSize || 0);
		case 'completed':
			return (b._parsedCompleted || 0) - (a._parsedCompleted || 0);
		default:
			return 0;
	}
}

function getInsertPosition(
	resultsContainer: HTMLElement,
	newResult: NyaaMetadataEnhanced,
	criteria: SortCriteria
): number {
	const cards = resultsContainer.querySelectorAll<HTMLElement>('[data-result-index]');
	for (let i = 0; i < cards.length; i++) {
		const idx = parseInt(cards[i].dataset.resultIndex || '0');
		if (compareBySort(newResult, carouselState.results[idx], criteria) < 0) {
			return i;
		}
	}
	return cards.length;
}

function handleSortChange(criteria: SortCriteria): void {
	carouselState.sortCriteria = criteria;

	document.querySelectorAll<HTMLButtonElement>('[data-sort-criteria]').forEach((btn) => {
		if (btn.dataset.sortCriteria === criteria) {
			btn.style.background = '#02A9FF';
		} else {
			btn.style.background = '#58BFF4';
		}
	});

	const resultsContainer = document.getElementById('modal-results-list');
	if (!resultsContainer || carouselState.results.length === 0) return;

	const sortedIndices = carouselState.results
		.map((_, idx: number) => idx)
		.sort((a: number, b: number) => compareBySort(carouselState.results[a], carouselState.results[b], criteria));

	const cards = Array.from(resultsContainer.querySelectorAll<HTMLElement>('[data-result-index]'));
	const fragment = document.createDocumentFragment();

	sortedIndices.forEach((idx: number) => {
		const card = cards.find((c) => c.dataset.resultIndex === String(idx));
		if (card) fragment.appendChild(card);
	});

	resultsContainer.replaceChildren(fragment);
}

// ==========================================
// Utility Functions
// ==========================================

function parseFileSize(sizeStr: string | undefined): number {
	if (!sizeStr) return 0;
	const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(bytes|[KMGT]iB|[KMGT]B)?$/i);
	if (!match) return 0;

	const value = parseFloat(match[1]);
	const unit = (match[2] || '').toUpperCase();

	const multipliers: Record<string, number> = {
		'BYTES': 1, '': 1,
		'KIB': 1024, 'KB': 1000,
		'MIB': 1024 ** 2, 'MB': 1000 ** 2,
		'GIB': 1024 ** 3, 'GB': 1000 ** 3,
		'TIB': 1024 ** 4, 'TB': 1000 ** 4,
	};

	return value * (multipliers[unit] || 1);
}

export function removeEpisodeCarousel(): void {
	document.getElementById(CAROUSEL_ID)?.remove();
	closeEpisodeModal();
}
