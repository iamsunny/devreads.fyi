// Shared by the layout and sitemap so utility URLs cannot drift between them.
export function isUtilityPage(pathname, base = '/') {
  const root = base.endsWith('/') ? base : base + '/';
  if (!pathname.startsWith(root)) return false;
  return /^(?:account|signin|favorites|saved|404)(?:\/|\.html)?$/.test(pathname.slice(root.length));
}

export function structuredData({ canonical, home, title, description, items, breadcrumbs = [] }) {
  const websiteId = `${home}#website`;
  const pageId = `${canonical}#webpage`;
  const graph = [];
  if (canonical === home) graph.push({
    '@type': 'WebSite', '@id': websiteId, name: 'devreads.fyi', url: home,
    description: 'Engineering articles from independent and company blogs, collected in one feed.', inLanguage: 'en',
  });
  graph.push({
    '@type': items ? 'CollectionPage' : 'WebPage', '@id': pageId,
    url: canonical, name: title, description, inLanguage: 'en',
    isPartOf: { '@id': websiteId },
    ...(items ? { mainEntity: { '@id': `${canonical}#list` } } : {}),
    ...(breadcrumbs.length > 1 ? { breadcrumb: { '@id': `${canonical}#breadcrumb` } } : {}),
  });
  if (items) graph.push({
    '@type': 'ItemList', '@id': `${canonical}#list`, name: title,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem', position: index + 1,
      item: { '@type': 'WebPage', name: item.title, url: new URL(item.url, canonical).href },
    })),
  });
  if (breadcrumbs.length > 1) graph.push({
    '@type': 'BreadcrumbList', '@id': `${canonical}#breadcrumb`,
    itemListElement: breadcrumbs.map((crumb, index) => ({
      '@type': 'ListItem', position: index + 1, name: crumb.name,
      item: new URL(crumb.url, canonical).href,
    })),
  });
  return { '@context': 'https://schema.org', '@graph': graph };
}

// Feed text can contain HTML. Keep it data even inside a script element.
export function serializeStructuredData(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
