import pMap from 'p-map';
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

async function fetchApiJson(url: string, conn: any | null, timeout = 15000): Promise<any> {
    try {
        if (conn) {
            const page = await conn.browser.newPage();
            try {
                await page.goto(url, { timeout });
                const text = await page.evaluate(() => document.querySelector('body > pre')?.textContent ?? '');
                return text ? JSON.parse(text) : null;
            } finally {
                await page.close();
            }
        } else {
            const res = await fetch(`${config.puppeteerRealBrowserService}?url=${encodeURIComponent(url)}&selector=${encodeURIComponent('body > pre')}`);
            const json = await res.json();
            const text = json.data?.at(0) || '';
            const preMatch = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
            return preMatch ? JSON.parse(preMatch[1]) : null;
        }
    } catch {
        return null;
    }
}

async function handler(ctx) {
    if (!config.puppeteerRealBrowserService && !config.chromiumExecutablePath) {
        throw new Error('PUPPETEER_REAL_BROWSER_SERVICE or CHROMIUM_EXECUTABLE_PATH is required to use this route.');
    }

    const { type = 'latest', section = 'posts' } = ctx.req.param();

    let link = 'https://www.dcard.tw/f';
    let api = 'https://www.dcard.tw/service/api/v2';
    let title = 'Dcard - ';

    if (section !== 'posts' && section !== 'popular' && section !== 'latest') {
        link += `/${section}`;
        api += `/forums/${section}`;
        title += `${section} - `;
    }
    api += '/posts';
    if (type === 'popular') {
        link += '?latest=false';
        api += '?popular=true';
        title += '熱門';
    } else {
        link += '?latest=true';
        api += '?popular=false';
        title += '最新';
    }

    // Cache the entire fetch operation to reduce requests to Dcard
    const cacheKey = `dcard:${section}:${type}`;
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
                // Try API directly first; fallback to homepage visit if blocked
                let apiHtml = await getPageWithRealBrowser(`${api}&limit=20`, 'body > pre', conn, 30000);
                if (!apiHtml || !apiHtml.includes('<pre')) {
                    await getPageWithRealBrowser(link, '.layout_main_2x7k', conn, 30000);
                    apiHtml = await getPageWithRealBrowser(`${api}&limit=20`, 'body > pre', conn, 30000);
                }
                if (!apiHtml) {
                    if (conn) {
                        await conn.browser.close();
                        conn = null;
                    }
                    throw new Error('Failed to fetch API data.');
                }

                // Extract JSON from pre tag
                const preMatch = apiHtml.match(/<pre[^>]*>(.*?)<\/pre>/s);
                const response = preMatch ? preMatch[1] : apiHtml;

                const data = JSON.parse(response);
                const items = data.map((item) => ({
                    title: `「${item.forumName}」${item.title}`,
                    link: `https://www.dcard.tw/f/${item.forumAlias}/p/${item.id}`,
                    description: item.excerpt,
                    author: `${item.school || '匿名'}．${item.gender === 'M' ? '男' : '女'}`,
                    pubDate: parseDate(item.createdAt),
                    category: [item.forumName, ...item.topics],
                    forumAlias: item.forumAlias,
                    id: item.id,
                }));

                // Fetch full content for each post
                const itemsWithContent = await pMap(
                    items,
                    async (item: any) => {
                        try {
                            const postApiUrl = `https://www.dcard.tw/service/api/v2/posts/${item.id}`;
                            const postData = await fetchApiJson(postApiUrl, conn);
                            if (postData?.content) {
                                item.description = processContent(postData.content);
                            }
                        } catch {
                            // keep excerpt on failure
                        }
                        return item;
                    },
                    { concurrency: 3 }
                );

                if (conn) {
                    await conn.browser.close();
                    conn = null;
                }

                return itemsWithContent;
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
