// @ts-nocheck
// Mirrored from agbrowse adaptive-fetch v2; keep runtime behavior aligned while cli-jaw mirror remains experimental.

/**
 * @param {string|URL} rawUrl
 */
export function resolvePublicEndpointCandidates(rawUrl) {
    const url = rawUrl instanceof URL ? rawUrl : new URL(String(rawUrl));
    return [
        ...githubCandidates(url),
        ...redditCandidates(url),
        ...hackerNewsCandidates(url),
        ...wikipediaCandidates(url),
        ...registryCandidates(url),
        ...arxivCandidates(url),
        ...blueskyCandidates(url),
        ...mastodonCandidates(url),
        ...stackExchangeCandidates(url),
        ...devToCandidates(url),
        ...crossRefCandidates(url),
        ...openLibraryCandidates(url),
        ...waybackCandidates(url),
        ...youtubeCandidates(url),
        ...xTwitterCandidates(url),
        ...v2exCandidates(url),
        ...lobstersCandidates(url),
    ];
}

/**
 * @param {URL} url
 */
function githubCandidates(url) {
    if (url.hostname !== 'github.com') return [];
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 5 && parts[2] === 'blob') {
        const [owner, repo, , branch, ...pathParts] = parts;
        return [{
            label: 'github-raw',
            url: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pathParts.join('/')}`,
            source: 'public_endpoint',
        }];
    }
    if (parts.length >= 2) {
        return [{
            label: 'github-repo-api',
            url: `https://api.github.com/repos/${parts[0]}/${parts[1]}`,
            source: 'public_endpoint',
        }];
    }
    return [];
}

/**
 * @param {URL} url
 */
function redditCandidates(url) {
    if (!/(^|\.)reddit\.com$/i.test(url.hostname)) return [];
    if (url.pathname.endsWith('.json')) return [];
    const clone = new URL(url.href);
    clone.pathname = clone.pathname.replace(/\/?$/, '.json');
    return [{ label: 'reddit-json', url: clone.href, source: 'public_endpoint' }];
}

/**
 * @param {URL} url
 */
function hackerNewsCandidates(url) {
    if (url.hostname !== 'news.ycombinator.com') return [];
    const id = url.searchParams.get('id');
    if (!id || !/^\d+$/.test(id)) return [];
    return [
        {
            label: 'hacker-news-item-api',
            url: `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
            source: 'public_endpoint',
        },
        {
            label: 'hacker-news-algolia-item-api',
            url: `https://hn.algolia.com/api/v1/items/${id}`,
            source: 'public_endpoint',
        },
    ];
}

/**
 * @param {URL} url
 */
function wikipediaCandidates(url) {
    const match = url.hostname.match(/^([a-z-]+)\.wikipedia\.org$/i);
    if (!match) return [];
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'wiki' || !parts[1]) return [];
    return [{
        label: 'wikipedia-summary-api',
        url: `https://${match[1]}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(parts.slice(1).join('/'))}`,
        source: 'public_endpoint',
    }];
}

/**
 * @param {URL} url
 */
function registryCandidates(url) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname === 'www.npmjs.com' && parts[0] === 'package' && parts[1]) {
        const decodedParts = decodeURIComponent(parts.slice(1).join('/')).split('/').filter(Boolean);
        const packageName = decodedParts[0]?.startsWith('@') && decodedParts[1]
            ? `${decodedParts[0]}/${decodedParts[1]}`
            : decodedParts[0];
        if (!packageName) return [];
        const version = packageName.startsWith('@') && decodedParts[2] === 'v'
            ? decodedParts[3]
            : (!packageName.startsWith('@') && decodedParts[1] === 'v' ? decodedParts[2] : '');
        const encodedPackageName = encodeURIComponent(packageName);
        const candidates = [];
        if (version) {
            candidates.push({
                label: 'npm-registry-version',
                url: `https://registry.npmjs.org/${encodedPackageName}/${encodeURIComponent(version)}`,
                source: 'public_endpoint',
            });
        }
        candidates.push({
            label: 'npm-registry-latest',
            url: `https://registry.npmjs.org/${encodedPackageName}/latest`,
            source: 'public_endpoint',
        });
        candidates.push({
            label: 'npm-registry',
            url: `https://registry.npmjs.org/${encodedPackageName}`,
            source: 'public_endpoint',
        });
        return candidates;
    }
    if (url.hostname === 'pypi.org' && parts[0] === 'project' && parts[1]) {
        return [{ label: 'pypi-json', url: `https://pypi.org/pypi/${encodeURIComponent(decodeURIComponent(parts[1]))}/json`, source: 'public_endpoint' }];
    }
    return [];
}

/**
 * @param {URL} url
 */
function arxivCandidates(url) {
    if (url.hostname !== 'arxiv.org') return [];
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'abs' || !parts[1]) return [];
    return [{ label: 'arxiv-api', url: `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(parts[1])}`, source: 'public_endpoint' }];
}

/**
 * @param {URL} url
 */
function blueskyCandidates(url) {
    if (url.hostname !== 'bsky.app') return [];
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'profile' || !parts[1]) return [];
    const actor = decodeURIComponent(parts[1]);
    if (parts[2] === 'post' && parts[3]) {
        const uri = `at://${actor}/app.bsky.feed.post/${decodeURIComponent(parts[3])}`;
        return [{
            label: 'bluesky-post-thread',
            url: `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}`,
            source: 'public_endpoint',
        }];
    }
    return [{
        label: 'bluesky-profile',
        url: `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`,
        source: 'public_endpoint',
    }];
}

/**
 * @param {URL} url
 */
function mastodonCandidates(url) {
    const parts = url.pathname.split('/').filter(Boolean);
    const statusMatch = parts.length >= 2 && parts[0].startsWith('@') && /^\d+$/.test(parts[1]);
    if (statusMatch) {
        return [{
            label: 'mastodon-status-api',
            url: `https://${url.hostname}/api/v1/statuses/${parts[1]}`,
            source: 'public_endpoint',
        }];
    }
    if (parts.length === 1 && parts[0].startsWith('@') && parts[0].length > 1) {
        return [{
            label: 'mastodon-account-lookup',
            url: `https://${url.hostname}/api/v1/accounts/lookup?acct=${encodeURIComponent(parts[0].slice(1))}`,
            source: 'public_endpoint',
        }];
    }
    return [];
}

/**
 * @param {URL} url
 */
function stackExchangeCandidates(url) {
    const site = stackExchangeSite(url.hostname);
    if (!site) return [];
    const match = url.pathname.match(/\/questions\/(\d+)(?:\/|$)/);
    if (!match) return [];
    return [{
        label: 'stackexchange-question-api',
        url: `https://api.stackexchange.com/2.3/questions/${match[1]}?site=${encodeURIComponent(site)}&filter=withbody`,
        source: 'public_endpoint',
    }];
}

/**
 * @param {string} hostname
 */
function stackExchangeSite(hostname) {
    if (hostname === 'stackoverflow.com' || hostname === 'www.stackoverflow.com') return 'stackoverflow';
    if (hostname === 'superuser.com' || hostname === 'www.superuser.com') return 'superuser';
    if (hostname === 'serverfault.com' || hostname === 'www.serverfault.com') return 'serverfault';
    if (hostname === 'askubuntu.com' || hostname === 'www.askubuntu.com') return 'askubuntu';
    const match = hostname.match(/^([a-z0-9-]+)\.stackexchange\.com$/i);
    return match ? match[1] : '';
}

/**
 * @param {URL} url
 */
function devToCandidates(url) {
    if (!['dev.to', 'www.dev.to'].includes(url.hostname)) return [];
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2 || parts[0] === 't') return [];
    return [{
        label: 'devto-article-api',
        url: `https://dev.to/api/articles/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`,
        source: 'public_endpoint',
    }];
}

/**
 * @param {URL} url
 */
function crossRefCandidates(url) {
    const doi = doiFromUrl(url);
    if (!doi) return [];
    return [{
        label: 'crossref-work-api',
        url: `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
        source: 'public_endpoint',
    }];
}

/**
 * @param {URL} url
 */
function doiFromUrl(url) {
    if (!['doi.org', 'www.doi.org', 'dx.doi.org'].includes(url.hostname)) return '';
    const doi = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    return /^10\.\d{4,9}\//i.test(doi) ? doi : '';
}

/**
 * @param {URL} url
 */
function openLibraryCandidates(url) {
    if (url.hostname !== 'openlibrary.org') return [];
    const parts = url.pathname.split('/').filter(Boolean);
    if ((parts[0] === 'works' || parts[0] === 'books') && parts[1]) {
        return [{
            label: `openlibrary-${parts[0]}-json`,
            url: `https://openlibrary.org/${parts[0]}/${encodeURIComponent(parts[1])}.json`,
            source: 'public_endpoint',
        }];
    }
    return [];
}

/**
 * @param {URL} url
 */
function waybackCandidates(url) {
    if (url.hostname !== 'web.archive.org') return [];
    const hrefWithoutFragment = url.href.slice(0, url.href.length - (url.hash || '').length);
    const match = hrefWithoutFragment.match(/^https?:\/\/web\.archive\.org\/web\/[^/]+\/(.+)$/i);
    if (!match) return [];
    let archivedUrl = match[1];
    if (!/^https?:\/\//i.test(archivedUrl)) archivedUrl = decodeURIComponent(archivedUrl);
    if (!/^https?:\/\//i.test(archivedUrl)) return [];
    return [{
        label: 'wayback-cdx-api',
        url: `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(archivedUrl)}&output=json&fl=timestamp,original,statuscode,mimetype,digest&filter=statuscode:200&limit=5`,
        source: 'public_endpoint',
    }];
}

/**
 * @param {URL} url
 */
function youtubeCandidates(url) {
    const videoUrl = youtubeVideoUrl(url);
    if (!videoUrl) return [];
    return [{
        label: 'youtube-oembed',
        url: `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`,
        source: 'public_endpoint',
    }];
}

/**
 * @param {URL} url
 */
function youtubeVideoUrl(url) {
    if (url.hostname === 'youtu.be') {
        const id = url.pathname.split('/').filter(Boolean)[0];
        return id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : '';
    }
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) return '';
    const id = url.searchParams.get('v');
    return id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : '';
}

/**
 * @param {URL} url
 */
function xTwitterCandidates(url) {
    const hostname = url.hostname.replace(/^www\./, '');
    if (!['x.com', 'twitter.com'].includes(hostname)) return [];
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 3 || parts[1] !== 'status' || !/^\d+$/.test(parts[2])) return [];
    return [{
        label: 'x-twitter-oembed',
        url: `https://publish.twitter.com/oembed?url=${encodeURIComponent(url.href)}`,
        source: 'public_endpoint',
    }];
}

/**
 * @param {URL} url
 */
function v2exCandidates(url) {
    if (!['v2ex.com', 'www.v2ex.com'].includes(url.hostname)) return [];
    const match = url.pathname.match(/^\/t\/(\d+)/);
    if (!match) return [];
    return [{
        label: 'v2ex-topic-api',
        url: `https://www.v2ex.com/api/topics/show.json?id=${match[1]}`,
        source: 'public_endpoint',
    }];
}

/**
 * @param {URL} url
 */
function lobstersCandidates(url) {
    if (!['lobste.rs', 'www.lobste.rs'].includes(url.hostname)) return [];
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 's' || !parts[1]) return [];
    const clone = new URL(url.href);
    clone.hostname = 'lobste.rs';
    clone.pathname = `/${parts.join('/')}.json`;
    clone.search = '';
    clone.hash = '';
    return [{
        label: 'lobsters-story-json',
        url: clone.href,
        source: 'public_endpoint',
    }];
}
