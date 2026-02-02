export interface MediaListEntry {
	progress: number;
}

export class AnilistApi {
	private static readonly GRAPHQL_URL = "https://anilist.co/graphql";

	async getUserProgress(anilistId: number): Promise<number | null> {
		const query = `
			query($id: Int) {
				Media(id: $id) {
					mediaListEntry {
						progress
					}
				}
			}
		`;

		const variables = {
			id: anilistId
		};

		try {
			const response = await fetch(AnilistApi.GRAPHQL_URL, {
				method: 'POST',
				credentials: 'include',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json',
				},
				body: JSON.stringify({ query, variables })
			});

			if (!response.ok) {
				return null;
			}

			const data = await response.json();

			if (data.errors) {
				return null;
			}

			return data.data?.Media?.mediaListEntry?.progress ?? null;
		} catch {
			return null;
		}
	}
}
