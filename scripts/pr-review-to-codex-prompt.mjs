#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SEVERITY_ORDER = [
  'blocking',
  'critical',
  'major',
  'minor',
  'nit',
  'question',
  'suggestion',
  'praise',
  'unclassified',
];

const SEVERITY_RANK = SEVERITY_ORDER.reduce((acc, severity, index) => {
  acc[severity] = index;
  return acc;
}, Object.create(null));

function parseArgs(argv) {
  const args = {
    pr: '',
    repo: '',
    out: '',
    maxBodyChars: 800,
    allReviews: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--pr' && argv[index + 1]) {
      args.pr = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--repo' && argv[index + 1]) {
      args.repo = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--out' && argv[index + 1]) {
      args.out = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--max-body-chars' && argv[index + 1]) {
      args.maxBodyChars = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--all-reviews') {
      args.allReviews = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelpAndExit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(args.maxBodyChars) || args.maxBodyChars < 120) {
    throw new Error('--max-body-chars must be a number >= 120');
  }

  return args;
}

function printHelpAndExit(code) {
  const help = `
Usage:
  node scripts/pr-review-to-codex-prompt.mjs --pr <number> [options]

Options:
  --pr <number>             Pull request number. If omitted, script tries current PR from branch.
  --repo <owner/name>       Repository slug. Default: current repo from gh context.
  --out <path>              Write generated prompt into a file.
  --max-body-chars <num>    Max chars per comment body in output (default: 800).
  --all-reviews             Include comments from all reviews (default is latest review only).
  -h, --help                Show this help.

Requirements:
  - gh CLI installed and authenticated (gh auth status)
`;
  process.stdout.write(help.trimStart());
  process.stdout.write('\n');
  process.exit(code);
}

function runGh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8' }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    throw new Error(
      `Failed to run gh command: gh ${args.join(' ')}\n${message}\n` +
        'Make sure gh is installed and authenticated.',
    );
  }
}

function resolvePrNumber(prArg, repo) {
  if (prArg.length > 0) {
    if (!/^\d+$/.test(prArg)) {
      throw new Error('--pr must be an integer PR number');
    }
    return Number(prArg);
  }

  const json = runGh(['pr', 'view', '--json', 'number', ...(repo ? ['--repo', repo] : [])]);
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed.number !== 'number') {
    throw new Error('Could not resolve current PR number via gh pr view');
  }
  return parsed.number;
}

function fetchPrMeta(repo, pr) {
  const result = runGh([
    'pr',
    'view',
    String(pr),
    '--json',
    'number,title,url,baseRefName,headRefName,author',
    ...(repo ? ['--repo', repo] : []),
  ]);
  return JSON.parse(result);
}

function fetchReviewComments(repo, pr) {
  const result = runGh([
    'api',
    '--paginate',
    '--method',
    'GET',
    `repos/${repo}/pulls/${pr}/comments?per_page=100`,
  ]);

  const chunks = result
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => JSON.parse(entry));

  return chunks.flatMap((chunk) => (Array.isArray(chunk) ? chunk : []));
}

function fetchReviews(repo, pr) {
  const result = runGh([
    'api',
    '--paginate',
    '--method',
    'GET',
    `repos/${repo}/pulls/${pr}/reviews?per_page=100`,
  ]);

  const chunks = result
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => JSON.parse(entry));

  return chunks.flatMap((chunk) => (Array.isArray(chunk) ? chunk : []));
}

function selectLatestReview(reviews) {
  const completedReviews = reviews.filter(
    (review) =>
      typeof review.submitted_at === 'string' &&
      review.submitted_at.length > 0 &&
      review.state !== 'PENDING',
  );
  const sorted = completedReviews.sort((a, b) =>
    String(b.submitted_at).localeCompare(String(a.submitted_at)),
  );
  return sorted[0] ?? null;
}

function selectCommentsByReviewId(comments, reviewId) {
  return comments.filter((comment) => comment.pull_request_review_id === reviewId);
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function detectSeverity(body) {
  const normalized = body.trim().toLowerCase();
  const matched = normalized.match(
    /^\[(blocking|critical|major|minor|nit|question|suggestion|praise)\]/,
  );
  if (matched && matched[1]) {
    return matched[1];
  }
  if (normalized.startsWith('blocking:')) return 'blocking';
  if (normalized.startsWith('critical:')) return 'critical';
  if (normalized.startsWith('major:')) return 'major';
  if (normalized.startsWith('minor:')) return 'minor';
  if (normalized.startsWith('nit:')) return 'nit';
  if (normalized.startsWith('question:')) return 'question';
  if (normalized.startsWith('suggestion:')) return 'suggestion';
  if (normalized.startsWith('praise:')) return 'praise';
  return 'unclassified';
}

function normalizeReviewComments(comments, maxBodyChars) {
  return comments
    .filter((comment) => typeof comment.body === 'string' && comment.body.trim().length > 0)
    .map((comment) => {
      const body = collapseWhitespace(comment.body);
      return {
        id: comment.id,
        severity: detectSeverity(body),
        body: truncate(body, maxBodyChars),
        path: comment.path || 'unknown-path',
        line: comment.line ?? comment.original_line ?? 1,
        author: comment.user?.login || 'unknown',
        createdAt: comment.created_at || '',
        url: comment.html_url || '',
      };
    })
    .sort((a, b) => {
      const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (severityDiff !== 0) {
        return severityDiff;
      }
      const dateDiff = a.createdAt.localeCompare(b.createdAt);
      if (dateDiff !== 0) {
        return dateDiff;
      }
      return String(a.id).localeCompare(String(b.id));
    });
}

function normalizeReviews(reviews, maxBodyChars) {
  return reviews
    .filter(
      (review) =>
        typeof review.body === 'string' &&
        review.body.trim().length > 0 &&
        review.state !== 'COMMENTED',
    )
    .map((review) => {
      const body = collapseWhitespace(review.body);
      return {
        state: review.state || 'UNKNOWN',
        body: truncate(body, maxBodyChars),
        author: review.user?.login || 'unknown',
        submittedAt: review.submitted_at || '',
        url: review.html_url || '',
      };
    });
}

function buildPrompt(meta, reviewComments, reviews) {
  const header = [
    '# Codex Prompt: Address PR Code Review Feedback',
    '',
    `PR: #${meta.number} ${meta.title}`,
    `URL: ${meta.url}`,
    `Author: ${meta.author?.login || 'unknown'}`,
    `Branches: ${meta.headRefName} -> ${meta.baseRefName}`,
    '',
    '## Task',
    'Apply the feedback below and update the code safely.',
    'Keep behavior backward-compatible unless a comment explicitly requests a breaking change.',
    '',
    '## Rules',
    '- Prioritize by severity: blocking > critical > major > minor > nit > question > suggestion > praise > unclassified.',
    '- For each addressed item, explain the fix briefly in commit/PR summary.',
    '- If a comment is unclear, add a short clarifying question instead of guessing.',
    '- Add/adjust tests for each behavior or bug fix.',
    '',
  ];

  const reviewSummarySection = ['## Review Summaries (non-inline)', ''];
  if (reviews.length === 0) {
    reviewSummarySection.push('- None');
  } else {
    reviews.forEach((review, index) => {
      reviewSummarySection.push(
        `${index + 1}. [${review.state}] @${review.author} (${review.submittedAt || 'unknown-date'})`,
      );
      reviewSummarySection.push(`   ${review.body}`);
      if (review.url) {
        reviewSummarySection.push(`   ${review.url}`);
      }
    });
  }
  reviewSummarySection.push('');

  const commentsSection = ['## Inline Review Comments', ''];
  if (reviewComments.length === 0) {
    commentsSection.push('- None found.');
  } else {
    reviewComments.forEach((comment, index) => {
      commentsSection.push(
        `${index + 1}. [${comment.severity}] ${comment.path}:${comment.line} by @${comment.author}`,
      );
      commentsSection.push(`   ${comment.body}`);
      if (comment.url) {
        commentsSection.push(`   ${comment.url}`);
      }
    });
  }

  const footer = [
    '',
    '## Expected Output',
    '- A patch that resolves agreed comments.',
    '- Updated tests where needed.',
    '- Short changelog grouped by severity labels.',
  ];

  return [...header, ...reviewSummarySection, ...commentsSection, ...footer].join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  const repo =
    args.repo || runGh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  const pr = resolvePrNumber(args.pr, repo);

  const meta = fetchPrMeta(repo, pr);
  const comments = fetchReviewComments(repo, pr);
  const reviews = fetchReviews(repo, pr);

  const latestReview = selectLatestReview(reviews);
  const reviewsForPrompt =
    args.allReviews || latestReview === null
      ? reviews
      : reviews.filter((review) => review.id === latestReview.id);
  const commentsForPrompt =
    args.allReviews || latestReview === null
      ? comments
      : selectCommentsByReviewId(comments, latestReview.id);

  const normalizedComments = normalizeReviewComments(commentsForPrompt, args.maxBodyChars);
  const normalizedReviews = normalizeReviews(reviewsForPrompt, args.maxBodyChars);
  const prompt = buildPrompt(meta, normalizedComments, normalizedReviews);

  if (args.out) {
    writeFileSync(args.out, prompt, { encoding: 'utf8' });
    process.stdout.write(`Prompt written to ${args.out}\n`);
    return;
  }

  process.stdout.write(prompt);
  process.stdout.write('\n');
}

main();
