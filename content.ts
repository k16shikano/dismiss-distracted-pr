// スクロールタイムアウトの管理用変数
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

// 処理済みのツイートを記録（グローバル）
const processedTweets = new Set<HTMLElement>();

// 処理中フラグ（同時に複数のツイートを処理しないようにする）
let isProcessing = false;

// 非表示にしたツイートの記録
function logDismissedTweet(accountName: string | null, reason: string): void {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] Dismissed: @${accountName || 'unknown'} - ${reason}`);
}

function isInViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

function containsEmoji(text: string): boolean {
  return /\p{Emoji}/u.test(text);
}

function containsHashtag(text: string): boolean {
  // ハッシュタグの検出を改善（#の後に1文字以上の文字が続く）
  return /#[^\s#]+/.test(text);
}

function containsEmptyLine(text: string): boolean {
  return /\n\s*\n/.test(text);
}

function isPromoted(tweetElement: HTMLElement): boolean {
  return tweetElement.innerText.includes("プロモーション");
}

function getAccountName(tweetElement: HTMLElement): string | null {
  const accountLink = tweetElement.querySelector('a[role="link"]');
  if (!accountLink) {
    return null;
  }
  
  const href = accountLink.getAttribute('href');
  return href ? href.substring(1) : null;
}

function shouldDismiss(text: string): boolean {
  const hasEmoji = containsEmoji(text);
  const hasHashtag = containsHashtag(text);
  const hasEmptyLine = containsEmptyLine(text);
  
  const reasons = [];
  if (hasEmoji) reasons.push("絵文字");
  if (hasHashtag) reasons.push("ハッシュタグ");
  if (hasEmptyLine) reasons.push("空行");
  
  // 2つ以上の条件が揃った場合のみミュート
  return reasons.length >= 2;
}

function closePremiumPlusModal() {
  const modal = Array.from(document.querySelectorAll('[role="dialog"], [data-testid="sheetDialog"]'))
    .find(el => el.textContent?.includes("プレミアムプラス") || el.textContent?.includes("Premium+"));
  if (modal) {
    const closeBtn = modal.querySelector('div[aria-label="閉じる"], div[aria-label="Close"]');
    if (closeBtn) {
      (closeBtn as HTMLElement).click();
    } else {
      (modal as HTMLElement).style.display = "none";
    }
  }
}

function closeMuteToast() {
  const toasts = Array.from(document.querySelectorAll('[role="alert"], [data-testid="toast"], [data-testid="toastContainer"] div'));
  const toast = toasts.find(el => {
    const text = el.textContent || '';
    return text.includes("ミュートしました") || 
           text.includes("muted") || 
           text.includes("取り消しますか");
  });
  
  if (toast) {
    (toast as HTMLElement).click();
    const overlays = document.querySelectorAll('[role="presentation"]');
    overlays.forEach(overlay => {
      if (overlay instanceof HTMLElement) {
        overlay.style.display = "none";
      }
    });
  }
}

function muteAccount(tweetElement: HTMLElement): void {
  const moreBtn = tweetElement.querySelector('[aria-label="More"]') || 
                 tweetElement.querySelector('[aria-label="その他"]') ||
                 tweetElement.querySelector('[data-testid="caret"]');
  
  if (!moreBtn) {
    return;
  }

  (moreBtn as HTMLElement).click();

  setTimeout(() => {
    const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
    const muteItem = menuItems.find(item => 
      item.innerText.includes("ミュート") || 
      item.innerText.includes("Mute")
    );
    if (muteItem) {
      const accountName = getAccountName(tweetElement);
      muteItem.click();
      logDismissedTweet(accountName, "プロモーション（条件を満たす）");
      
      setTimeout(closeMuteToast, 500);
      setTimeout(closeMuteToast, 1000);
      setTimeout(closeMuteToast, 1500);
    }
  }, 300);
}

// フォローしていないアカウントかどうかを判定
function isNotFollowingAccount(tweetElement: HTMLElement): boolean {
  // まず「フォロー中」ボタンを探す（フォローしている場合）
  const followingButton = tweetElement.querySelector('[data-testid*="unfollow"], [aria-label*="フォロー中"], [aria-label*="Following"]');
  
  if (followingButton) {
    console.log('Found "Following" button, account is followed');
    return false; // フォローしている
  }
  
  // 次に「フォロー」ボタンを探す（フォローしていない場合）
  // data-testid="follow"を探す
  let followButton = tweetElement.querySelector('[data-testid="follow"]');
  
  if (!followButton) {
    // より広範囲にボタンを探す
    const buttons = Array.from(tweetElement.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]'));
    
    // aria-labelで「フォロー」または「Follow」を含むが、「フォロー中」や「Following」を含まないボタンを探す
    const foundButton = buttons.find(btn => {
      const label = btn.getAttribute('aria-label') || '';
      const text = btn.textContent || '';
      const hasFollowLabel = /フォロー|Follow/i.test(label);
      const hasFollowingLabel = /フォロー中|Following/i.test(label);
      const hasFollowText = /^フォロー$|^Follow$/i.test(text.trim());
      const hasFollowingText = /フォロー中|Following/i.test(text);
      
      return (hasFollowLabel && !hasFollowingLabel) || (hasFollowText && !hasFollowingText);
    });
    
    followButton = foundButton ? foundButton as HTMLElement : null;
  }
  
  // フォローボタンが見つかった場合、フォローしていない
  return followButton !== null;
}

// リツイートかどうかを判定
function isRetweet(tweetElement: HTMLElement): boolean {
  // リツイートの表示を探す（複数の方法で）
  let retweetIndicator = tweetElement.querySelector('[data-testid="socialContext"]');
  
  if (!retweetIndicator) {
    retweetIndicator = tweetElement.querySelector('[data-testid="retweet"]');
  }
  
  // テキスト内容でも確認
  const textContent = tweetElement.innerText || '';
  const hasRetweetText = /リツイート|Retweeted|retweeted/i.test(textContent);
  
  // リツイートアイコンを探す
  const retweetIcon = tweetElement.querySelector('[data-testid="retweet"]');
  
  return retweetIndicator !== null || retweetIcon !== null || hasRetweetText;
}

// リツイートの元のツイート主のアカウント名を取得
function getOriginalTweetAuthor(tweetElement: HTMLElement): string | null {
  // リツイートの場合、元のツイート主の情報を探す
  // リツイートの構造では、通常は複数のアカウントリンクがある
  // 最初のリンクはリツイートした人、2番目以降が元のツイート主の可能性がある
  
  const allLinks = Array.from(tweetElement.querySelectorAll('a[role="link"][href^="/"]'));
  
  // リツイートの場合、元のツイート主のリンクを探す
  const textContent = tweetElement.innerText || '';
  const accountMatch = textContent.match(/@(\w+)/);
  if (accountMatch && accountMatch.length > 1) {
    return accountMatch[1];
  }
  
  // リンクから取得を試みる
  if (allLinks.length > 1) {
    const originalAuthorLink = allLinks[1];
    const href = originalAuthorLink.getAttribute('href');
    if (href) {
      return href.substring(1).split('/')[0];
    }
  }
  
  return null;
}

// 元のツイート主の要素を取得（リツイートの場合）
function getOriginalTweetAuthorElement(tweetElement: HTMLElement): HTMLElement | null {
  // リツイートの場合、元のツイート主のアカウント名を取得
  const originalAuthor = getOriginalTweetAuthor(tweetElement);
  
  if (!originalAuthor) {
    return null;
  }
  
  // 元のツイート主のアカウント名を含むリンクを探す
  const authorLink = Array.from(tweetElement.querySelectorAll('a[role="link"][href^="/"]'))
    .find(link => {
      const href = link.getAttribute('href');
      return href && href.includes(originalAuthor);
    });
  
  if (!authorLink) {
    return null;
  }
  
  // そのリンクを含むセクションを探す（通常は親要素の親要素あたり）
  let parent = authorLink.parentElement;
  let depth = 0;
  while (parent && depth < 5) {
    // 元のツイート主の情報を含むセクションを探す
    // 通常、リツイートの下部に表示される
    if (parent.querySelector(`a[href="/${originalAuthor}"]`)) {
      return parent as HTMLElement;
    }
    parent = parent.parentElement;
    depth++;
  }
  
  return null;
}

// フォローしている人からのリツイートではないかどうかを判定
function isNotRetweetFromFollowing(tweetElement: HTMLElement): boolean {
  // リツイートでない場合は、この関数では判定しない（isNotFollowingAccountで判定される）
  if (!isRetweet(tweetElement)) {
    return false;
  }
  
  // リツイートの場合、元のツイート主がフォローしているかどうかを判定
  // リツイート全体ではなく、元のツイート主の部分だけを探す必要がある
  
  // まず、元のツイート主のアカウント名を取得
  const originalAuthor = getOriginalTweetAuthor(tweetElement);
  
  // 元のツイート主の要素を取得
  const originalAuthorElement = getOriginalTweetAuthorElement(tweetElement);
  
  // 元のツイート主の部分だけを探す（リツイートした人の部分は無視）
  const searchElement = originalAuthorElement || tweetElement;
  
  // まず「フォロー中」ボタンを探す（フォローしている場合）
  // 元のツイート主の部分だけを探す（リツイートした人の部分は無視）
  let followingButton: HTMLElement | null = null;
  
  if (originalAuthorElement) {
    // 元のツイート主の要素内で探す（これが最も確実）
    const buttons = Array.from(originalAuthorElement.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]'));
    followingButton = buttons.find(btn => {
      const label = btn.getAttribute('aria-label') || '';
      const text = btn.textContent || '';
      return /フォロー中|Following/i.test(label) || /フォロー中|Following/i.test(text);
    }) as HTMLElement | null;
  }
  
  // 元のツイート主の要素が見つからない場合、元のツイート主のアカウント名を含む部分だけを探す
  if (!followingButton && originalAuthor) {
    const allButtons = Array.from(tweetElement.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]'));
    // 元のツイート主のアカウント名を含むセクション内のボタンのみを探す
    followingButton = allButtons.find(btn => {
      // ボタンの近くに元のツイート主のアカウント名があるか確認
      let parent = btn.parentElement;
      let depth = 0;
      while (parent && depth < 3) {
        if (parent.textContent && parent.textContent.includes(`@${originalAuthor}`)) {
          const label = btn.getAttribute('aria-label') || '';
          const text = btn.textContent || '';
          return /フォロー中|Following/i.test(label) || /フォロー中|Following/i.test(text);
        }
        parent = parent.parentElement;
        depth++;
      }
      return false;
    }) as HTMLElement | null;
  }
  
  if (followingButton) {
    console.log('Retweet from following account (found Following button near original author)');
    return false; // フォローしている人からのリツイート
  }
  
  // 次に「フォロー」ボタンを探す（フォローしていない場合）
  // 元のツイート主の部分だけを探す（リツイートした人の部分は無視）
  let followButton: HTMLElement | null = null;
  
  if (originalAuthorElement) {
    // 元のツイート主の要素内で探す（これが最も確実）
    const buttons = Array.from(originalAuthorElement.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]'));
    const followBtn = buttons.find(btn => {
      const label = btn.getAttribute('aria-label') || '';
      const text = btn.textContent || '';
      const hasFollowLabel = /フォロー|Follow/i.test(label);
      const hasFollowingLabel = /フォロー中|Following/i.test(label);
      const hasFollowText = /^フォロー$|^Follow$/i.test(text.trim());
      const hasFollowingText = /フォロー中|Following/i.test(text);
      
      return (hasFollowLabel && !hasFollowingLabel) || (hasFollowText && !hasFollowingText);
    });
    
    followButton = followBtn ? followBtn as HTMLElement : null;
  }
  
  // 元のツイート主の要素が見つからない場合、元のツイート主のアカウント名を含む部分だけを探す
  if (!followButton && originalAuthor) {
    const allButtons = Array.from(tweetElement.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]'));
    // 元のツイート主のアカウント名を含むセクション内のボタンのみを探す
    const followBtn = allButtons.find(btn => {
      // ボタンの近くに元のツイート主のアカウント名があるか確認
      let parent = btn.parentElement;
      let depth = 0;
      while (parent && depth < 3) {
        if (parent.textContent && parent.textContent.includes(`@${originalAuthor}`)) {
          const label = btn.getAttribute('aria-label') || '';
          const text = btn.textContent || '';
          const hasFollowLabel = /フォロー|Follow/i.test(label);
          const hasFollowingLabel = /フォロー中|Following/i.test(label);
          const hasFollowText = /^フォロー$|^Follow$/i.test(text.trim());
          const hasFollowingText = /フォロー中|Following/i.test(text);
          
          return (hasFollowLabel && !hasFollowingLabel) || (hasFollowText && !hasFollowingText);
        }
        parent = parent.parentElement;
        depth++;
      }
      return false;
    });
    
    followButton = followBtn ? followBtn as HTMLElement : null;
  }
  
  // ボタンが見つからない場合、デフォルトで「フォローしていない」と判定
  // （リツイートの場合、フォローしていないアカウントからのリツイートが多いため）
  const isNotFromFollowing = followButton !== null;
  
  // ボタンが見つからない場合は、より積極的に「フォローしていない」と判定
  // リツイートの場合、元のツイート主の部分を正確に特定するのが難しいため、
  // 「フォロー中」ボタンが明確に見つかった場合のみ「フォローしている」と判定
  const defaultToNotFollowing = followButton === null && followingButton === null;
  
  // リツイートの場合、安全のため「フォローしていない」と判定する
  // 「フォロー中」ボタンが明確に見つかった場合のみ例外
  return isNotFromFollowing || defaultToNotFollowing;
}

// 「興味がない」メニューをクリック
function dismissAsNotInterested(tweetElement: HTMLElement, reason: string): void {
  const moreBtn = tweetElement.querySelector('[aria-label="More"]') || 
                 tweetElement.querySelector('[aria-label="その他"]') ||
                 tweetElement.querySelector('[data-testid="caret"]');
  
  if (!moreBtn) {
    return;
  }

  (moreBtn as HTMLElement).click();

  setTimeout(() => {
    const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
    const notInterestedItem = menuItems.find(item => 
      item.innerText.includes("興味がない") || 
      item.innerText.includes("Not interested") ||
      item.innerText.includes("Not interested in this")
    );
    if (notInterestedItem) {
      const accountName = getAccountName(tweetElement);
      notInterestedItem.click();
      logDismissedTweet(accountName, reason);
    }
  }, 300);
}

function scanTweets(): void {
  // 既に処理中の場合はスキップ
  if (isProcessing) {
    return;
  }
  
  const tweetArticles = document.querySelectorAll('article');
  
  if (tweetArticles.length === 0) {
    return;
  }
  
  // 処理対象のツイートを収集（処理済みでない、ビューポート内のもの）
  const tweetsToProcess: HTMLElement[] = [];
  
  tweetArticles.forEach((article) => {
    const tweetEl = article as HTMLElement;
    
    // すでに処理済みのツイートはスキップ
    if (processedTweets.has(tweetEl)) {
      return;
    }
    
    // ビューポート内のツイートのみを処理対象に追加
    if (isInViewport(tweetEl)) {
      tweetsToProcess.push(tweetEl);
    }
  });
  
  if (tweetsToProcess.length === 0) {
    closePremiumPlusModal();
    return;
  }
  
  // 処理開始
  isProcessing = true;
  
  // 最初のツイートを処理
  processNextTweet(tweetsToProcess, 0);
}

function processNextTweet(tweets: HTMLElement[], index: number): void {
  if (index >= tweets.length) {
    isProcessing = false;
    closePremiumPlusModal();
    return;
  }
  
  const tweetEl = tweets[index];
  
  // プロモーションツイートの処理
  const isPromo = isPromoted(tweetEl);
  let shouldSkip = false;
  
  if (isPromo) {
    const text = tweetEl.innerText;
    if (shouldDismiss(text)) {
      muteAccount(tweetEl);
      processedTweets.add(tweetEl);
      shouldSkip = true;
      // ミュート処理は非同期なので、少し待ってから次へ
      setTimeout(() => {
        processNextTweet(tweets, index + 1);
      }, 2000);
      return;
    }
  }
  
  // プロモーションツイートでない場合、またはプロモーションツイートでも条件を満たさない場合、フォロー/リツイート判定を実行
  if (!shouldSkip) {
    // リツイートかどうかを先に確認
    const isRT = isRetweet(tweetEl);
    
    if (isRT) {
      // リツイートの場合：フォローしている人からのリツイートではない場合のみ「興味がない」に分類
      if (isNotRetweetFromFollowing(tweetEl)) {
        dismissAsNotInterested(tweetEl, "リツイート（フォローしていないアカウント）");
        processedTweets.add(tweetEl);
        // 非同期処理なので、少し待ってから次へ
        setTimeout(() => {
          processNextTweet(tweets, index + 1);
        }, 1500);
        return;
      }
    } else {
      // 通常のツイートの場合：フォローしていないアカウントによるツイートを「興味がない」に分類
      if (isNotFollowingAccount(tweetEl)) {
        dismissAsNotInterested(tweetEl, "フォローしていないアカウント");
        processedTweets.add(tweetEl);
        // 非同期処理なので、少し待ってから次へ
        setTimeout(() => {
          processNextTweet(tweets, index + 1);
        }, 1500);
        return;
      }
    }
  }
  
  // 処理が不要な場合、すぐに次へ
  processedTweets.add(tweetEl);
  processNextTweet(tweets, index + 1);
}

// MutationObserverで動的追加にも対応
const observer = new MutationObserver(() => {
  if (!scrollTimeout) {
    scrollTimeout = setTimeout(() => {
      scanTweets();
      scrollTimeout = null;
    }, 500);
  }
});

// document.bodyが存在する場合のみobserverを設定
if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
} else {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    });
  }
}

// スクロールイベントの監視を追加
window.addEventListener('scroll', () => {
  if (!scrollTimeout) {
    scrollTimeout = setTimeout(() => {
      scanTweets();
      scrollTimeout = null;
    }, 500);
  }
});

// スクリプトの初期化
try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => scanTweets(), 1000);
    });
  } else {
    setTimeout(() => scanTweets(), 1000);
  }
} catch (error) {
  console.error('Error initializing extension:', error);
}
