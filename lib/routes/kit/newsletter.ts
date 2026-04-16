import { load } from 'cheerio';

import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import { isValidHost } from '@/utils/valid-host';

export const route: Route = {
    path: '/newsletter/:username',
    categories: ['blog'],
    view: ViewType.Articles,
    example: '/kit/newsletter/newsletter',
    parameters: { username: 'Kit creator username (subdomain of kit.com)' },
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'Newsletter',
    maintainers: ['giveanornot'],
    handler,
    url: 'kit.com',
};

interface KitPost {
    id: number;
    title: string;
    slug: string;
    status: string;
    readingTime: number;
    publishedAt: string;
    url: string;
    thumbnailUrl: string | null;
    thumbnailAlt: string | null;
    introContent: string;
    isPaid: boolean | null;
}

interface KitListProps {
    data: {
        bio: string;
        name: string;
        imageUrl: string;
    };
    recentPosts: KitPost[];
    canonicalUrl: string;
    creatorProfileName: string;
}

interface KitPostProps {
    content: string;
}

function extractProps<T>(html: string): T {
    const $ = load(html);
    const scriptText = $('script')
        .filter((_, el) => ($(el).html() ?? '').includes('window.__PROPS__'))
        .html();

    if (!scriptText) {
        throw new Error('Could not find __PROPS__ data on page');
    }

    const start = scriptText.indexOf('window.__PROPS__ = ');
    if (start === -1) {
        throw new Error('Could not parse __PROPS__ data');
    }

    const jsonStart = scriptText.indexOf('{', start);
    let depth = 0;
    let inString = false;
    let escape = false;
    let jsonEnd = jsonStart;
    for (let i = jsonStart; i < scriptText.length; i++) {
        const ch = scriptText[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (ch === '\\' && inString) {
            escape = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) {
            continue;
        }
        if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                jsonEnd = i;
                break;
            }
        }
    }

    return JSON.parse(scriptText.slice(jsonStart, jsonEnd + 1)) as T;
}

async function handler(ctx) {
    const { username } = ctx.req.param();

    if (!isValidHost(username)) {
        throw new InvalidParameterError('Invalid username');
    }

    const listHtml = await ofetch(`https://${username}.kit.com/profile/posts`);
    const { data, recentPosts, canonicalUrl, creatorProfileName } = extractProps<KitListProps>(listHtml);

    const items = await Promise.all(
        recentPosts.map((post) =>
            cache.tryGet(post.url, async () => {
                let description = post.introContent || '';
                if (!post.isPaid) {
                    const postHtml = await ofetch(post.url);
                    const { content } = extractProps<KitPostProps>(postHtml);
                    if (content) {
                        const $c = load(content);
                        $c('[style]').removeAttr('style');
                        $c('[bgcolor]').removeAttr('bgcolor');
                        $c('[color]').removeAttr('color');
                        $c('[cellpadding]').removeAttr('cellpadding');
                        $c('[cellspacing]').removeAttr('cellspacing');
                        $c('[align]').removeAttr('align');
                        $c('[width]').removeAttr('width');
                        $c('[height]').removeAttr('height');
                        $c('style').remove();
                        $c('footer, div.footer').remove();
                        $c('[role="presentation"]').remove();
                        $c('a[href*="unsubscribe"], a[href*="preferences"]').closest('p').remove();
                        description = $c('body').html() || description;
                    }
                }
                return {
                    title: post.title,
                    description,
                    link: post.url,
                    pubDate: post.publishedAt ? parseDate(post.publishedAt) : undefined,
                    guid: String(post.id),
                    author: creatorProfileName,
                };
            })
        )
    );

    return {
        title: creatorProfileName,
        description: data.bio ?? '',
        link: canonicalUrl ?? `https://${username}.kit.com`,
        image: data.imageUrl ?? '',
        item: items,
    };
}
