import { escapeText } from 'entities';

import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const siteUrl = 'https://www.artists.tw/gigs/';
const apiUrl = 'https://tw-gigs.orbis-f60.workers.dev/api/events';
const taipeiTime = new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Taipei',
});

interface Gig {
    slug: string;
    title: string;
    start_at: string | null;
    first_seen_at: string | null;
    city_label: string | null;
    venue_name: string | null;
    performers: string[];
    image_url: string | null;
}

export const route: Route = {
    path: '/gigs',
    categories: ['multimedia'],
    example: '/artists-tw/gigs',
    name: '台灣現場演出',
    url: 'www.artists.tw/gigs/',
    maintainers: ['giveanornot'],
    radar: [
        {
            source: ['www.artists.tw/gigs/'],
            target: '/gigs',
        },
    ],
    handler,
};

async function handler() {
    const { events } = await ofetch<{ events: Gig[] }>(apiUrl, {
        query: { per: 100, sort: 'newest' },
    });

    return {
        title: 'Artists.tw｜台灣現場演出',
        link: siteUrl,
        item: events.map((event) => {
            const location = [event.city_label, event.venue_name].filter(Boolean).join('・');
            const performers = event.performers?.join('、');
            const details = [event.start_at && `演出時間：${taipeiTime.format(parseDate(event.start_at))}`, location && `地點：${location}`, performers && `演出者：${performers}`];

            return {
                title: event.title,
                link: `${siteUrl}${encodeURIComponent(event.slug)}/`,
                description: details
                    .filter(Boolean)
                    .map((detail) => `<p>${escapeText(String(detail))}</p>`)
                    .join(''),
                pubDate: event.first_seen_at ? parseDate(event.first_seen_at) : undefined,
                image: event.image_url ?? undefined,
            };
        }),
    };
}
