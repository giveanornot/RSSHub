import { Route } from '@/types';
import { parseDate } from '@/utils/parse-date';
import { config } from '@/config';
import { connect, Options } from 'puppeteer-real-browser';

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

async function getPageWithRealBrowser(url: string, selector: string, conn: any | null, timeout = 30000) {
    try {
        if (conn) {
            const page = conn.page;
            await page.goto(url, { timeout });
            let verify: boolean | null = null;
            const startDate = Date.now();
            while (!verify && Date.now() - startDate < timeout) {
                // eslint-disable-next-line no-await-in-loop, no-restricted-syntax
                verify = await page.evaluate((sel) => (document.querySelector(sel) ? true : null), selector).catch(() => null);
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

async function handler(ctx) {
    if (!config.puppeteerRealBrowserService && !config.chromiumExecutablePath) {
        throw new Error('PUPPETEER_REAL_BROWSER_SERVICE or CHROMIUM_EXECUTABLE_PATH is required to use this route.');
    }

    const { type = 'latest', section = 'posts' } = ctx.req.param();

    let link = `https://www.dcard.tw/f`;
    let api = `https://www.dcard.tw/service/api/v2`;
    let title = `Dcard - `;

    if (section !== 'posts' && section !== 'popular' && section !== 'latest') {
        link += `/${section}`;
        api += `/forums/${section}`;
        title += `${section} - `;
    }
    api += `/posts`;
    if (type === 'popular') {
        link += '?latest=false';
        api += '?popular=true';
        title += '熱門';
    } else {
        link += '?latest=true';
        api += '?popular=false';
        title += '最新';
    }

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
        // Visit the frontend page first to establish session/bypass Cloudflare
        const html = await getPageWithRealBrowser(link, '.layout_main_2x7k', conn, 30000);
        if (!html) {
            if (conn) {
                await conn.browser.close();
                conn = null;
            }
            throw new Error('Failed to load Dcard page. Cloudflare may be blocking access.');
        }

        // Get the API page content
        const apiHtml = await getPageWithRealBrowser(`${api}&limit=100`, 'body > pre', conn, 30000);
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

        // Note: ProcessFeed also uses puppeteer, but since we can't easily pass cookies/session
        // through the service API, we'll keep descriptions as excerpts for now
        // TO-DO: Enhance to fetch full content if using local connection

        if (conn) {
            await conn.browser.close();
            conn = null;
        }

        return {
            title,
            link,
            description: '不想錯過任何有趣的話題嗎？趕快加入我們吧！',
            item: items,
        };
    } catch (error) {
        if (conn) {
            await conn.browser.close();
        }
        throw error;
    }
}
