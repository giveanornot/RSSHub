import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const siteUrl = 'https://tam.gov.taipei/News_Photo.aspx?n=EF86D8AF23B9A85B&sms=F32C4FF0AC5C2801';
const apiUrl = 'https://tam.gov.taipei/OpenData.aspx?SN=9B70FA1EEE3AED84';

type Article = {
    title: string;
    Source: string;
    內容: string;
    上版日期: string;
    相關圖片?: Array<{
        url: string;
    }>;
};

export const route: Route = {
    path: '/astronomy-news',
    categories: ['government'],
    example: '/tam/astronomy-news',
    name: '天文新知',
    url: 'tam.gov.taipei/News_Photo.aspx?n=EF86D8AF23B9A85B&sms=F32C4FF0AC5C2801',
    radar: [
        {
            source: ['tam.gov.taipei/News_Photo.aspx?n=EF86D8AF23B9A85B&sms=F32C4FF0AC5C2801'],
            target: '/astronomy-news',
        },
    ],
    handler,
};

async function handler() {
    const articles = await ofetch<Article[]>(apiUrl);

    return {
        title: '天文新知 - 臺北市立天文科學教育館',
        description: '臺北市立天文科學教育館發布的天文新知。',
        link: siteUrl,
        item: articles.map((article) => ({
            title: article.title,
            link: article.Source,
            description: article.內容,
            pubDate: timezone(parseDate(article.上版日期), 8),
            image: article.相關圖片?.[0]?.url,
        })),
    };
}
