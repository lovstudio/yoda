// Renders the public roadmap from the app's single source of truth:
// src/renderer/features/roadmap/roadmap-data.ts + the English locale strings.
import {
  getReportCounts,
  getRoadmapCell,
  getRoadmapReport,
  getRuntimeProgress,
  ROADMAP_CATEGORIES,
  ROADMAP_RUNTIMES,
} from '../../src/renderer/features/roadmap/roadmap-data';
import { roadmap as strings } from '../../src/renderer/lib/i18n/locales/en.json';

// Display names for the runtime columns (kept tiny on purpose — the full
// runtime registry is an app-side module with a much wider surface).
const RUNTIME_NAMES = {
  claude: 'Claude Code',
  codex: 'Codex',
  hermes: 'Hermes',
};

const STATUS_COLORS = {
  shipped: 'var(--lime)',
  testing: 'var(--cyan)',
  inProgress: 'var(--copper)',
  researching: 'var(--soft)',
  planned: 'rgba(217, 234, 223, 0.28)',
  na: 'rgba(217, 234, 223, 0.12)',
};

const STATUS_ORDER = ['shipped', 'testing', 'inProgress', 'researching', 'planned', 'na'];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter(Boolean));
  return node;
}

function statusChip(status) {
  return el(
    'span',
    { class: 'status', title: strings.status[status] },
    el('span', { class: 'dot', style: `background:${STATUS_COLORS[status]}` }),
    el('span', { text: strings.status[status] })
  );
}

function heroSection() {
  const hero = el('section', { class: 'hero' });
  hero.append(el('h1', { text: strings.title }), el('p', { text: strings.subtitle }));
  return hero;
}

function bookSection() {
  const counts = getReportCounts();
  const total = counts.published + counts.draft + counts.planned;
  const card = el('section', { class: 'card' });
  card.append(
    el('h2', { text: strings.book.bookTitle }),
    el('p', { class: 'sub', text: strings.book.bookSubtitle }),
    el('p', { class: 'sub', text: strings.book.desc })
  );
  const countsRow = el('div', { class: 'book-counts' });
  const chapterLabel = strings.book.chapterCount.replace('{{count}}', String(total));
  countsRow.append(
    el('strong', { text: chapterLabel }),
    el('span', { text: `${strings.report.published} ${counts.published}` }),
    el('span', { text: `${strings.report.draft} ${counts.draft}` }),
    el('span', { text: `${strings.report.planned} ${counts.planned}` })
  );
  card.append(countsRow);
  return card;
}

function legendSection() {
  const legend = el('div', { class: 'legend' });
  for (const status of STATUS_ORDER) {
    legend.append(
      el(
        'span',
        {},
        el('span', { class: 'dot', style: `background:${STATUS_COLORS[status]}` }),
        el('span', { text: strings.status[status] })
      )
    );
  }
  return legend;
}

function matrixSection() {
  const wrap = el('section', {});
  wrap.append(
    el('h2', { text: strings.matrix.title, style: 'margin:0 0 4px;font-size:1.05rem' }),
    el('p', {
      class: 'sub',
      text: strings.matrix.desc,
      style: 'margin:0 0 14px;color:var(--muted);font-size:0.84rem',
    })
  );

  const table = el('table');
  const headRow = el('tr');
  headRow.append(el('th', { text: strings.matrix.featureColumn }));
  for (const runtime of ROADMAP_RUNTIMES) {
    const th = el('th', { class: 'runtime-col', text: RUNTIME_NAMES[runtime.id] ?? runtime.id });
    if (runtime.upcoming) {
      th.append(el('span', { class: 'upcoming-tag', text: strings.matrix.upcoming }));
    } else {
      const progress = getRuntimeProgress(runtime.id);
      th.append(
        el('span', {
          class: 'runtime-progress',
          text: `${progress.shipped}/${progress.total} ${strings.status.shipped.toLowerCase()}`,
        })
      );
    }
    headRow.append(th);
  }
  table.append(el('thead', {}, headRow));

  const tbody = el('tbody');
  for (const category of ROADMAP_CATEGORIES) {
    const categoryRow = el('tr', { class: 'category' });
    categoryRow.append(
      el('th', {
        colspan: String(1 + ROADMAP_RUNTIMES.length),
        text: strings.categories[category.id] ?? category.id,
      })
    );
    tbody.append(categoryRow);

    for (const feature of category.features) {
      const featureStrings = strings.features[feature.id] ?? { name: feature.id, desc: '' };
      const report = getRoadmapReport(feature);
      const row = el('tr');

      const nameCell = el('td');
      const nameWrap = el('span', { class: 'feature-name' });
      if (report.status === 'published' && report.url) {
        nameWrap.append(
          el('a', {
            href: report.url,
            title: strings.report.read,
            text: featureStrings.name,
          })
        );
      } else {
        nameWrap.append(el('span', { text: featureStrings.name }));
      }
      nameCell.append(nameWrap);
      if (featureStrings.desc) {
        nameCell.append(el('span', { class: 'feature-desc', text: featureStrings.desc }));
      }
      row.append(nameCell);

      for (const runtime of ROADMAP_RUNTIMES) {
        const cell = el('td', { class: 'cell' });
        if (runtime.upcoming) {
          cell.append(statusChip('planned'));
        } else {
          cell.append(statusChip(getRoadmapCell(feature, runtime.id).status));
        }
        row.append(cell);
      }
      tbody.append(row);
    }
  }
  table.append(tbody);

  wrap.append(
    el('div', { class: 'matrix-wrap' }, table),
    el('div', { style: 'height:14px' }),
    legendSection()
  );
  return wrap;
}

function ctaSection() {
  const card = el('section', { class: 'card cta' });
  const copy = el('div');
  copy.append(
    el('h2', { text: strings.cta.title }),
    el('p', { class: 'sub', text: strings.cta.desc, style: 'margin:4px 0 0' })
  );
  card.append(
    copy,
    el('a', { href: 'https://github.com/lovstudio/yoda/issues', text: strings.cta.button })
  );
  return card;
}

const root = document.getElementById('roadmap-root');
root.append(heroSection(), bookSection(), matrixSection(), ctaSection());
