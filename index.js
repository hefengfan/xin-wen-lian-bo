import fetch from 'node-fetch';
import jsdom from 'jsdom';
const { JSDOM } = jsdom;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NEWS_PATH = path.join(__dirname, 'news');
const CATALOGUE_JSON_PATH = path.join(NEWS_PATH, 'catalogue.json');
const README_PATH = path.join(__dirname, 'README.md');

// Utility Functions (moved to the top for clarity)
const add0 = num => num < 10 ? ('0' + num) : num;

const formatDate = (date) => {
    return '' + date.getFullYear() + add0(date.getMonth() + 1) + add0(date.getDate());
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)); // Add a sleep function to avoid rate limiting

const readFile = path => {
    return new Promise((resolve, reject) => {
        fs.readFile(path, {}, (err, data) => {
            if (err) reject(err);
            resolve(data);
        });
    });
};

const writeFile = (path, data) => {
    return new Promise((resolve, reject) => {
        fs.writeFile(path, data, err => {
            if (err) reject(err);
            resolve(true);
        });
    });
};

const getNewsList = async (date) => {
    try {
        const HTML = await fetch(`http://tv.cctv.com/lm/xwlb/day/${date}.shtml`);
        if (!HTML.ok) {
            console.warn(`Failed to fetch news list for ${date}: ${HTML.status} ${HTML.statusText}`);
            return null; // Indicate failure
        }
        const text = await HTML.text(); // Get the text content
        const fullHTML = `<!DOCTYPE html><html><head></head><body>${text}</body></html>`;
        const dom = new JSDOM(fullHTML);
        const nodes = dom.window.document.querySelectorAll('a');
        var links = [];
        nodes.forEach(node => {
            let link = node.href;
            if (!links.includes(link)) links.push(link);
        });
        const abstract = links.shift();
        console.log(`Successfully fetched news list for ${date}`);
        return {
            abstract,
            news: links
        };
    } catch (error) {
        console.error(`Error fetching news list for ${date}:`, error);
        return null; // Indicate failure
    }
};

const getAbstract = async (link) => {
    try {
        const HTML = await fetch(link);
        if (!HTML.ok) {
            console.warn(`Failed to fetch abstract from ${link}: ${HTML.status} ${HTML.statusText}`);
            return null;
        }
        const text = await HTML.text();
        const dom = new JSDOM(text);
        const abstractElement = dom.window.document.querySelector(
            '#page_body > div.allcontent > div.video18847 > div.playingCon > div.nrjianjie_shadow > div > ul > li:nth-child(1) > p'
        );

        if (!abstractElement) {
            console.warn(`Abstract element not found in ${link}`);
            return null;
        }

        const abstract = abstractElement.innerHTML.replaceAll('；', "；\n\n").replaceAll('：', "：\n\n");
        console.log(`Successfully fetched abstract from ${link}`);
        return abstract;
    } catch (error) {
        console.error(`Error fetching abstract from ${link}:`, error);
        return null;
    }
};

const getNews = async (links) => {
    const linksLength = links.length;
    console.log('共', linksLength, '则新闻, 开始获取');
    var news = [];
    for (let i = 0; i < linksLength; i++) {
        const url = links[i];
        try {
            const htmlResponse = await fetch(url);
            if (!htmlResponse.ok) {
                console.warn(`Failed to fetch news from ${url}: ${htmlResponse.status} ${htmlResponse.statusText}`);
                news.push({ title: `Failed to fetch: ${url}`, content: `Failed to fetch content from ${url}. Status: ${htmlResponse.status}` });
                continue;
            }
            const html = await htmlResponse.text();
            const dom = new JSDOM(html);
            const titleElement = dom.window.document.querySelector('#page_body > div.allcontent > div.video18847 > div.playingVideo > div.tit');
            const contentElement = dom.window.document.querySelector('#content_area');

            const title = titleElement?.innerHTML?.replace('[视频]', '') || `No Title Found - ${url}`;
            const content = contentElement?.innerHTML || `No Content Found - ${url}`;

            news.push({ title, content });
            console.count('获取的新闻则数');
        } catch (error) {
            console.error(`Error fetching news from ${url}:`, error);
            news.push({ title: `Error fetching: ${url}`, content: `Error fetching content from ${url}: ${error}` });
        }
        await sleep(500); // Wait half a second between requests to avoid rate limiting
    }
    console.log('成功获取所有新闻');
    return news;
};

const newsToMarkdown = ({ date, abstract, news, links }) => {
    let mdNews = '';
    const newsLength = news.length;
    for (let i = 0; i < newsLength; i++) {
        const { title, content } = news[i];
        const link = links[i];
        mdNews += `### ${title}\n\n${content}\n\n[查看原文](${link})\n\n`;
    }
    return `# 《新闻联播》 (${date})\n\n## 新闻摘要\n\n${abstract}\n\n## 详细新闻\n\n---\n\n(更新时间戳: ${new Date().getTime()})\n\n`;
};

const saveTextToFile = async (savePath, text) => {
    await writeFile(savePath, text);
};

const updateCatalogue = async ({ catalogueJsonPath, readmeMdPath, date, abstract }) => {
    try {
        let catalogueJson = [];
        try {
            const data = await readFile(catalogueJsonPath);
            catalogueJson = JSON.parse(data.toString() || '[]');
        } catch (readError) {
            console.warn("Catalogue file not found or invalid JSON. Creating new catalogue.");
        }

        catalogueJson.unshift({
            date,
            abstract,
        });
        let textJson = JSON.stringify(catalogueJson, null, 2); // Pretty print JSON
        await writeFile(catalogueJsonPath, textJson);
        console.log('Updated catalogue.json');

        try {
            const readmeData = await readFile(readmeMdPath);
            const readmeText = readmeData.toString();
            const newEntry = `- [${date}](./news/${date}.md)`;
            const updatedReadme = readmeText.replace('<!-- INSERT -->', `<!-- INSERT -->\n${newEntry}`);
            await writeFile(readmeMdPath, updatedReadme);
            console.log('Updated README.md');
        } catch (readmeError) {
            console.error("Error updating README.md:", readmeError);
        }
    } catch (updateError) {
        console.error("Error updating catalogue:", updateError);
    }
};


async function getAllNews(startDate, endDate) {
    let currentDate = new Date(startDate);
    const end = new Date(endDate);

    while (currentDate <= end) {
        const dateStr = formatDate(currentDate);
        console.log(`Processing date: ${dateStr}`);

        try {
            const newsListResult = await getNewsList(dateStr);

            if (!newsListResult) {
                console.warn(`Skipping ${dateStr} due to failure in getting news list.`);
                currentDate.setDate(currentDate.getDate() + 1);
                continue;
            }

            const abstract = await getAbstract(newsListResult.abstract);
            if (!abstract) {
                console.warn(`Skipping ${dateStr} due to failure in getting abstract.`);
                currentDate.setDate(currentDate.getDate() + 1);
                continue;
            }

            const news = await getNews(newsListResult.news);
            const md = newsToMarkdown({
                date: dateStr,
                abstract,
                news,
                links: newsListResult.news
            });

            const NEWS_MD_PATH = path.join(NEWS_PATH, dateStr + '.md');
            await saveTextToFile(NEWS_MD_PATH, md);
            await updateCatalogue({
                catalogueJsonPath: CATALOGUE_JSON_PATH,
                readmeMdPath: README_PATH,
                date: dateStr,
                abstract: abstract
            });

            console.log(`Successfully processed ${dateStr}`);
        } catch (error) {
            console.error(`Failed to process ${dateStr}:`, error);
        }

        currentDate.setDate(currentDate.getDate() + 1); // Increment date
        await sleep(1000); // Add a delay to avoid rate limiting
    }

    console.log("Finished processing all dates.");
}

// Main execution
async function main() {
    const startDate = new Date('2009-01-01'); // Replace with your desired start date
    const endDate = new Date(); // Today's date

    // Create directories if they don't exist
    if (!fs.existsSync(NEWS_PATH)) {
        fs.mkdirSync(NEWS_PATH, { recursive: true });
    }

    try {
        await getAllNews(startDate, endDate);
    } catch (error) {
        console.error("An error occurred during the main process:", error);
    }
}

main();
