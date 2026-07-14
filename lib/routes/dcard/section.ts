import { connect, type Options } from 'puppeteer-real-browser';

import { config } from '@/config';
import type { Route } from '@/types';
import cache from '@/utils/cache';
import { parseDate } from '@/utils/parse-date';

export const route: Route = {
    path: '/:section/:type?',
    categories: ['bbs'],
    example: '/dcard/funny/popular',
    parameters: { section: '板塊名稱，URL 中獲得', type: '排序，popular 熱門；latest 最新，默認為 latest' },
    features: {
        requireConfig: false,
        requirePuppeteer: true,
        antiCrawler: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: '板塊帖子',
    maintainers: ['HenryQW'],
    handler,
};

const realBrowserOption: Options = {
    args: ['--start-maximized'],
    turnstile: true,
    headless: false,
    customConfig: {
        chromePath: config.chromiumExecutablePath,
    },
    connectOption: {
        defaultViewport: null,
    },
    plugins: [],
};

function processContent(content: string): string {
    let body = content;
    body = body.replaceAll(/https?:\/\/\S+/gi, (url) => {
        if (/\.(jpe?g|gif|png|webp)([?#]\S*)?$/i.test(url) || /megapx\.dcard\.tw\/v1\/images\//i.test(url)) {
            return `<img src="${url}">`;
        }
        return `<a href="${url}">${url}</a>`;
    });
    body = body.replaceAll('\n', '<br>');
    return body;
}

function normalizeStructuredData(input: any): any[] {
    if (!input) {
        return [];
    }
    if (Array.isArray(input)) {
        return input.flatMap(normalizeStructuredData);
    }
    if (Array.isArray(input['@graph'])) {
        return input['@graph'].flatMap(normalizeStructuredData);
    }
    return [input];
}

function decodeHtmlEntities(text: string): string {
    return text
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'");
}

function isSocialMediaPosting(item: any): boolean {
    const type = item?.['@type'];
    return type === 'SocialMediaPosting' || (Array.isArray(type) && type.includes('SocialMediaPosting'));
}

function imageList(image: any): string[] {
    if (!image) {
        return [];
    }
    const images = Array.isArray(image) ? image : [image];
    return images
        .map((entry) => {
            if (typeof entry === 'string') {
                return entry;
            }
            return entry?.url;
        })
        .filter(Boolean);
}

function extractPostsFromStructuredData(html: string) {
    const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    const posts = matches.flatMap((match) => {
        try {
            return normalizeStructuredData(JSON.parse(decodeHtmlEntities(match[1].trim()))).filter(isSocialMediaPosting);
        } catch {
            return [];
        }
    });

    return posts.map((post) => {
        const author = post.author || {};
        const images = imageList(post.image);
        const text = post.text || '';
        const imageHtml = images.map((url) => `<p><img src="${url}"></p>`).join('');
        const description = `${text ? processContent(text) : ''}${imageHtml}`;
        const link = post.url || post.mainEntityOfPage;
        const id = String(link || '').match(/\/p\/(\d+)/)?.[1] ?? link;

        return {
            title: post.headline,
            link,
            description,
            author: author.name || author.alternateName || 'Dcard',
            pubDate: parseDate(post.datePublished),
            updated: parseDate(post.dateModified || post.datePublished),
            category: ['Dcard'],
            id,
        };
    });
}

async function getPageWithRealBrowser(url: string, selector: string, conn: any | null, timeout = 30000) {
    try {
        if (conn) {
            const page = conn.page;
            await page.goto(url, { timeout });
            let verify: boolean | null = null;
            const startDate = Date.now();
            while (!verify && Date.now() - startDate < timeout) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    verify = await page.evaluate((sel) => (document.querySelector(sel) ? true : null), selector);
                } catch {
                    verify = null;
                }
                // eslint-disable-next-line no-await-in-loop
                await new Promise((r) => setTimeout(r, 1000));
            }
            if (selector.includes('application/ld+json')) {
                let hasPosts = false;
                const structuredDataStartDate = Date.now();
                while (!hasPosts && Date.now() - structuredDataStartDate < timeout) {
                    try {
                        // eslint-disable-next-line no-await-in-loop
                        hasPosts = await page.evaluate(() => [...document.scripts].some((script) => script.type === 'application/ld+json' && script.textContent?.includes('SocialMediaPosting')));
                    } catch {
                        hasPosts = false;
                    }
                    if (!hasPosts) {
                        // eslint-disable-next-line no-await-in-loop
                        await new Promise((r) => setTimeout(r, 1000));
                    }
                }
            }
            return await page.content();
        } else {
            const res = await fetch(`${config.puppeteerRealBrowserService}?url=${encodeURIComponent(url)}&selector=${encodeURIComponent(selector)}`);
            const json = await res.json();
            return (json.data?.at(0) || '') as string;
        }
    } catch {
        return '';
    }
}

async function handler(ctx) {
    if (!config.puppeteerRealBrowserService && !config.chromiumExecutablePath) {
        throw new Error('PUPPETEER_REAL_BROWSER_SERVICE or CHROMIUM_EXECUTABLE_PATH is required to use this route.');
    }

    const { type = 'latest', section = 'posts' } = ctx.req.param();

    let link = 'https://www.dcard.tw/f';
    let title = 'Dcard - ';

    if (section !== 'posts' && section !== 'popular' && section !== 'latest') {
        link += `/${section}`;
        title += `${section} - `;
    }
    if (type === 'popular') {
        link += '?latest=false';
        title += '熱門';
    } else {
        link += '?latest=true';
        title += '最新';
    }

    // Cache the entire fetch operation to reduce requests to Dcard
    const cacheKey = `dcard:structured:${section}:${type}`;
    const items = await cache.tryGet(
        cacheKey,
        async () => {
            let conn: any | null = null;

            if (!config.puppeteerRealBrowserService) {
                conn = await connect(realBrowserOption);

                setTimeout(async () => {
                    if (conn) {
                        await conn.browser.close();
                    }
                }, 60000);
            }

            try {
                const html = await getPageWithRealBrowser(link, 'script[type="application/ld+json"]', conn, 30000);
                const items = extractPostsFromStructuredData(html).filter((item) => item.title && item.link);

                if (items.length === 0) {
                    if (conn) {
                        await conn.browser.close();
                        conn = null;
                    }
                    throw new Error('Failed to fetch Dcard structured data.');
                }

                if (conn) {
                    await conn.browser.close();
                    conn = null;
                }

                return items;
            } catch (error) {
                if (conn) {
                    await conn.browser.close();
                }
                throw error;
            }
        },
        30 * 60 // Cache for 30 minutes (longer due to full content fetch)
    );

    return {
        title,
        link,
        description: '不想錯過任何有趣的話題嗎？趕快加入我們吧！',
        item: items,
    };
}
