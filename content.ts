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
  // より確実にアカウント名を取得する
  // 複数の方法を試す
  const links = Array.from(tweetElement.querySelectorAll('a[role="link"][href^="/"]'));
  
  // 最初のリンクがアカウント名の可能性が高い
  for (const link of links) {
    const href = link.getAttribute('href');
    if (href && href.startsWith('/') && !href.includes('/status/')) {
      const accountName = href.substring(1).split('/')[0];
      // アカウント名として有効な形式か確認
      if (accountName && accountName.length > 0 && !accountName.includes(' ')) {
        return accountName;
      }
    }
  }
  
  return null;
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
    const accountName = getAccountName(tweetElement);
    console.warn(`[${new Date().toLocaleTimeString()}] Failed to mute @${accountName || 'unknown'}: More button not found`);
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
    } else {
      const accountName = getAccountName(tweetElement);
      console.warn(`[${new Date().toLocaleTimeString()}] Failed to mute @${accountName || 'unknown'}: Mute menu item not found`);
    }
  }, 300);
}

// フォローしていないアカウントかどうかを判定
function isNotFollowingAccount(tweetElement: HTMLElement): boolean {
  const accountName = getAccountName(tweetElement);
  console.log(`[DEBUG] Checking follow status for @${accountName || 'unknown'}`);
  
  // すべてのボタンを取得
  const allButtons = Array.from(tweetElement.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]'));
  
  // ボタンのテキスト内容で判定
  // 「Xさんのフォローを解除」→ フォローしている
  // 「Xさんをフォロー」→ フォローしていない
  
  // まず「フォローを解除」ボタンを探す（フォローしている場合）
  const unfollowButton = allButtons.find(btn => {
    const text = btn.textContent || '';
    const label = btn.getAttribute('aria-label') || '';
    // 「フォローを解除」または「Unfollow」を含む
    return /フォローを解除|Unfollow/i.test(text) || /フォローを解除|Unfollow/i.test(label);
  });
  
  if (unfollowButton) {
    console.log(`[DEBUG] @${accountName || 'unknown'}: Following (found "Unfollow" button)`);
    console.log(`[DEBUG] Button text: "${unfollowButton.textContent?.substring(0, 50)}"`);
    return false; // フォローしている → 表示
  }
  
  // 次に「フォロー」ボタンを探す（フォローしていない場合）
  const followButton = allButtons.find(btn => {
    const text = btn.textContent || '';
    const label = btn.getAttribute('aria-label') || '';
    // 「フォロー」または「Follow」を含むが、「フォローを解除」を含まない
    const hasFollow = /フォロー|Follow/i.test(text) || /フォロー|Follow/i.test(label);
    const hasUnfollow = /フォローを解除|Unfollow/i.test(text) || /フォローを解除|Unfollow/i.test(label);
    return hasFollow && !hasUnfollow;
  });
  
  if (followButton) {
    console.log(`[DEBUG] @${accountName || 'unknown'}: Not following (found "Follow" button)`);
    console.log(`[DEBUG] Button text: "${followButton.textContent?.substring(0, 50)}"`);
    return true; // フォローしていない → 非表示
  }
  
  // ボタンが見つからない場合
  console.log(`[DEBUG] @${accountName || 'unknown'}: No follow buttons found`);
  console.log(`[DEBUG] All button texts:`, allButtons.map(btn => btn.textContent?.substring(0, 50)).filter(Boolean));
  
  // ボタンが見つからない場合、デフォルトで「フォローしていない」と判定
  // （フォローしていない人のツイートは基本的に非表示にする）
  console.log(`[DEBUG] @${accountName || 'unknown'}: Defaulting to not following (no buttons found)`);
  return true; // ボタンが見つからない場合は「フォローしていない」と判定（非表示にする）
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
  const retweeterName = getAccountName(tweetElement);
  
  // リンクから取得を試みる（リツイートした人以外のリンクを探す）
  for (let i = 0; i < allLinks.length; i++) {
    const link = allLinks[i];
    const href = link.getAttribute('href');
    if (href) {
      const accountName = href.substring(1).split('/')[0];
      // リツイートした人以外のアカウント名を返す
      if (accountName && accountName !== retweeterName) {
        console.log(`[DEBUG] Found original author from link: @${accountName} (retweeter: @${retweeterName})`);
        return accountName;
      }
    }
  }
  
  // リンクから取得できない場合、テキストから取得を試みる
  const textContent = tweetElement.innerText || '';
  const accountMatches = textContent.match(/@(\w+)/g);
  if (accountMatches && accountMatches.length > 1) {
    // 2番目以降の@マッチが元のツイート主の可能性が高い
    for (let i = 1; i < accountMatches.length; i++) {
      const match = accountMatches[i].match(/@(\w+)/);
      if (match && match[1] && match[1] !== retweeterName) {
        console.log(`[DEBUG] Found original author from text: @${match[1]} (retweeter: @${retweeterName})`);
        return match[1];
      }
    }
  }
  
  console.log(`[DEBUG] Could not find original author (retweeter: @${retweeterName})`);
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
  
  // リツイートした人のアカウント名を取得
  const retweeterName = getAccountName(tweetElement);
  console.log(`[DEBUG] Retweeter: @${retweeterName || 'unknown'}`);
  
  // リツイートした人がフォローしているかどうかを先にチェック
  // リツイートした人がフォローしている場合、元のツイート主が見つからなくても「フォローしている」と判定
  const isRetweeterFollowing = !isNotFollowingAccount(tweetElement);
  console.log(`[DEBUG] Retweeter @${retweeterName || 'unknown'} is following: ${isRetweeterFollowing}`);
  
  // リツイートした人がフォローしていない場合、元のツイート主の判定は不要（リツイートした人からのリツイートなので非表示対象）
  if (!isRetweeterFollowing) {
    console.log(`[DEBUG] Retweeter is not following, dismissing retweet`);
    return true; // リツイートした人がフォローしていないので非表示
  }
  
  // リツイートした人がフォローしている場合、元のツイート主の判定に関係なくスルーする
  // （フォローしている人のリツイートはすべて表示する）
  console.log(`[DEBUG] Retweeter is following, keeping retweet regardless of original author`);
  return false; // リツイートした人がフォローしているので表示
}

// 「興味がない」メニューをクリック
function dismissAsNotInterested(tweetElement: HTMLElement, reason: string): void {
  const accountName = getAccountName(tweetElement);
  console.log(`[DEBUG] Attempting to dismiss @${accountName || 'unknown'}: ${reason}`);
  
  // より広範囲にMoreボタンを探す
  let moreBtn = tweetElement.querySelector('[aria-label="More"]') || 
                 tweetElement.querySelector('[aria-label="その他"]') ||
                 tweetElement.querySelector('[data-testid="caret"]');
  
  // 追加のセレクタを試す
  if (!moreBtn) {
    const allButtons = Array.from(tweetElement.querySelectorAll('button, div[role="button"]'));
    moreBtn = allButtons.find(btn => {
      const label = btn.getAttribute('aria-label') || '';
      return /More|その他/i.test(label);
    }) as HTMLElement | null;
  }
  
  if (!moreBtn) {
    console.warn(`[${new Date().toLocaleTimeString()}] Failed to dismiss @${accountName || 'unknown'}: More button not found`);
    return;
  }

  console.log(`[DEBUG] Clicking More button for @${accountName || 'unknown'}`);
  (moreBtn as HTMLElement).click();

  // メニューが表示されるまで少し長めに待つ
  setTimeout(() => {
    const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
    console.log(`[DEBUG] Found ${menuItems.length} menu items`);
    
    if (menuItems.length > 0) {
      console.log(`[DEBUG] Menu items:`, menuItems.map(item => item.innerText?.substring(0, 50)));
    }
    
    const notInterestedItem = menuItems.find(item => {
      const text = item.innerText || '';
      return text.includes("興味がない") || 
             text.includes("Not interested") ||
             text.includes("Not interested in this") ||
             text.includes("興味がありません");
    });
    
    if (notInterestedItem) {
      console.log(`[DEBUG] Found "Not interested" menu item, clicking...`);
      notInterestedItem.click();
      logDismissedTweet(accountName, reason);
    } else {
      console.warn(`[${new Date().toLocaleTimeString()}] Failed to dismiss @${accountName || 'unknown'}: "Not interested" menu item not found`);
      console.warn(`[DEBUG] Available menu items:`, menuItems.map(item => item.innerText?.substring(0, 50)));
    }
  }, 500); // 待機時間を延長
}

function scanTweets(): void {
  try {
    // 既に処理中の場合はスキップ
    if (isProcessing) {
      console.log('[DEBUG] Already processing, skipping scan');
      return;
    }
    
    const tweetArticles = document.querySelectorAll('article');
    console.log(`[DEBUG] Found ${tweetArticles.length} article elements`);
    
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
    
    console.log(`[DEBUG] Found ${tweetsToProcess.length} tweets to process`);
    
    if (tweetsToProcess.length === 0) {
      closePremiumPlusModal();
      return;
    }
    
    // 処理開始
    isProcessing = true;
    console.log(`[DEBUG] Starting to process ${tweetsToProcess.length} tweets`);
    
    // 最初のツイートを処理
    processNextTweet(tweetsToProcess, 0);
  } catch (error) {
    console.error('Error in scanTweets:', error);
    isProcessing = false;
  }
}

function processNextTweet(tweets: HTMLElement[], index: number): void {
  try {
    if (index >= tweets.length) {
      console.log(`[DEBUG] Finished processing ${tweets.length} tweets`);
      isProcessing = false;
      closePremiumPlusModal();
      return;
    }
    
    const tweetEl = tweets[index];
    const accountName = getAccountName(tweetEl);
    console.log(`[DEBUG] Processing tweet ${index + 1}/${tweets.length}: @${accountName || 'unknown'}`);
    
    // プロモーションツイートの処理
    const isPromo = isPromoted(tweetEl);
    let shouldSkip = false;
    
    if (isPromo) {
      console.log(`[DEBUG] @${accountName || 'unknown'}: Promoted tweet detected`);
      const text = tweetEl.innerText;
      if (shouldDismiss(text)) {
        console.log(`[DEBUG] @${accountName || 'unknown'}: Conditions met, muting...`);
        muteAccount(tweetEl);
        processedTweets.add(tweetEl);
        shouldSkip = true;
        // ミュート処理は非同期なので、少し待ってから次へ
        setTimeout(() => {
          processNextTweet(tweets, index + 1);
        }, 2000);
        return;
      } else {
        console.log(`[DEBUG] @${accountName || 'unknown'}: Promoted but conditions not met`);
      }
    }
    
    // プロモーションツイートでない場合、またはプロモーションツイートでも条件を満たさない場合、フォロー/リツイート判定を実行
    if (!shouldSkip) {
      // リツイートかどうかを先に確認
      const isRT = isRetweet(tweetEl);
      console.log(`[DEBUG] @${accountName || 'unknown'}: Is retweet: ${isRT}`);
      
      if (isRT) {
        // リツイートの場合：フォローしている人からのリツイートではない場合のみ「興味がない」に分類
        const notFromFollowing = isNotRetweetFromFollowing(tweetEl);
        console.log(`[DEBUG] @${accountName || 'unknown'}: Not retweet from following: ${notFromFollowing}`);
        if (notFromFollowing) {
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
        const notFollowing = isNotFollowingAccount(tweetEl);
        console.log(`[DEBUG] @${accountName || 'unknown'}: Not following account: ${notFollowing}`);
        if (notFollowing) {
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
    console.log(`[DEBUG] @${accountName || 'unknown'}: Keeping tweet (following account or other reason)`);
    processedTweets.add(tweetEl);
    processNextTweet(tweets, index + 1);
  } catch (error) {
    console.error('Error in processNextTweet:', error);
    isProcessing = false;
  }
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
  console.log('Twitter Ad Filter Extension: Initialized');
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try {
        setTimeout(() => scanTweets(), 1000);
      } catch (error) {
        console.error('Error in DOMContentLoaded handler:', error);
      }
    });
  } else {
    try {
      setTimeout(() => scanTweets(), 1000);
    } catch (error) {
      console.error('Error in initial scanTweets:', error);
    }
  }
} catch (error) {
  console.error('Error initializing extension:', error);
  console.error('Error details:', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
}

