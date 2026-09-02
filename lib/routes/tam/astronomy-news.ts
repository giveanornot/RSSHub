import { load } from 'cheerio';

import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';

const siteUrl = 'https://tam.gov.taipei/News_Photo.aspx?n=EF86D8AF23B9A85B&sms=F32C4FF0AC5C2801';
const apiUrl = 'https://tam.gov.taipei/OpenData.aspx?SN=C9A81F0ACF28E7D7';

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
    const response = await ofetch<string>(apiUrl);
    const $ = load(response, { xmlMode: true });
    const articles = $('Data')
        .toArray()
        .map((article) => {
            const $article = $(article);
            const relatedImages = JSON.parse($article.find('[name="相關圖片"]').text()) as Array<{ url: string }>;

            return {
                title: $article.find('[name="title"]').text(),
                link: $article.find('[name="Source"]').text(),
                description: $article.find('[name="內容"]').text(),
                pubDate: timezone(parseDate($article.find('[name="上版日期"]').text()), 8),
                image: relatedImages[0]?.url,
            };
        });

    return {
        title: '天文新知 - 臺北市立天文科學教育館',
        description: '臺北市立天文科學教育館發布的天文新知。',
        link: siteUrl,
        item: articles,
    };
}
