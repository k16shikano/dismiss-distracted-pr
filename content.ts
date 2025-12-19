// スクロールタイムアウトの管理用変数
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

// 処理済みのツイートを記録（グローバル）
const processedTweets = new Set<HTMLElement>();

// 処理中フラグ（同時に複数のツイートを処理しないようにする）
let isProcessing = false;

// 最後に処理が実行された時刻
let lastProcessTime = Date.now();

// 処理が止まっていないか定期的にチェックして再開
function startWatchdog(): void {
  setInterval(() => {
    // 「おすすめ」タブでない場合は処理しない
    if (!isRecommendedTab()) {
      return;
    }
    
    const now = Date.now();
    const timeSinceLastProcess = now - lastProcessTime;
    
    // 5秒以上処理が実行されていない場合、処理を再開
    if (timeSinceLastProcess > 5000) {
      console.log('[DEBUG] Watchdog: No processing for 5+ seconds, resetting flags and resuming');
      isProcessing = false;
      lastProcessTime = now;
      scanTweets();
      return;
    }
    
    // 処理中フラグがtrueのまま30秒以上経過している場合、リセット
    if (isProcessing && timeSinceLastProcess > 30000) {
      console.log('[DEBUG] Watchdog: Processing flag stuck for 30+ seconds, resetting');
      isProcessing = false;
      lastProcessTime = now;
      scanTweets();
      return;
    }
    
    // 処理中でなく、新しいツイートがある場合は処理を開始
    if (!isProcessing) {
      const tweetArticles = document.querySelectorAll('article');
      const unprocessedTweets = Array.from(tweetArticles).filter(
        article => !processedTweets.has(article as HTMLElement)
      );
      
      if (unprocessedTweets.length > 0) {
        console.log(`[DEBUG] Watchdog: Found ${unprocessedTweets.length} unprocessed tweets, resuming`);
        lastProcessTime = now;
        scanTweets();
      }
    }
  }, 1000); // 1秒ごとにチェック
}

// 「おすすめ」タブが選択されているかどうかを判定
function isRecommendedTab(): boolean {
  // URLで判定（ホーム画面でない場合はfalse）
  const url = window.location.href;
  const isHomePage = url.includes('/home') || /^https?:\/\/(x\.com|twitter\.com)\/?$/.test(url);
  if (!isHomePage) {
    return false;
  }
  
  // タブ要素を探す
  // 「おすすめ」タブは通常、aria-selected="true"またはdata-testidで識別できる
  const tabs = document.querySelectorAll('[role="tab"]');
  for (const tab of Array.from(tabs)) {
    const text = tab.textContent || '';
    const ariaLabel = tab.getAttribute('aria-label') || '';
    const isSelected = tab.getAttribute('aria-selected') === 'true';
    
    // 「おすすめ」または「For you」タブが選択されているか確認
    if ((text.includes('おすすめ') || text.includes('For you') || 
         ariaLabel.includes('おすすめ') || ariaLabel.includes('For you')) && isSelected) {
      return true;
    }
  }
  
  // タブが見つからない場合、デフォルトで「おすすめ」と判定（ホーム画面の場合）
  // ただし、明示的に「フォロー中」タブが選択されている場合はfalse
  const followingTab = Array.from(tabs).find(tab => {
    const text = tab.textContent || '';
    const ariaLabel = tab.getAttribute('aria-label') || '';
    return (text.includes('フォロー中') || text.includes('Following') ||
            ariaLabel.includes('フォロー中') || ariaLabel.includes('Following')) &&
           tab.getAttribute('aria-selected') === 'true';
  });
  
  if (followingTab) {
    return false; // 「フォロー中」タブが選択されている
  }
  
  // ホーム画面で、タブが見つからない場合は「おすすめ」と判定
  return url.includes('/home') || /^https?:\/\/(x\.com|twitter\.com)\/?$/.test(url);
}

// 一時的に非表示にしたツイート（フィルタリング中）
const hiddenTweets = new Map<HTMLElement, { display: string; visibility: string }>();

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

// 「このポストは関連性がありません」ボタンをクリック
function clickRelevanceButton(tweetElement: HTMLElement, accountName: string | null): Promise<void> {
  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 20; // 最大2秒待つ（100ms × 20）
    
    const checkButton = () => {
      // 「このポストは関連性がありません」または「This post is not relevant」ボタンを探す
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]')) as HTMLElement[];
      const relevanceButton = buttons.find(btn => {
        const text = btn.textContent || '';
        const ariaLabel = btn.getAttribute('aria-label') || '';
        return text.includes('関連性がありません') || 
               text.includes('not relevant') ||
               text.includes('Not relevant') ||
               ariaLabel.includes('関連性がありません') ||
               ariaLabel.includes('not relevant') ||
               ariaLabel.includes('Not relevant');
      });
      
      if (relevanceButton) {
        console.log(`[DEBUG] Found relevance button for @${accountName || 'unknown'}, clicking...`);
        relevanceButton.click();
        setTimeout(() => resolve(), 200);
        return;
      }
      
      if (attempts >= maxAttempts) {
        console.log(`[DEBUG] Relevance button not found for @${accountName || 'unknown'} after ${attempts} attempts`);
        resolve(); // ボタンが見つからなくても続行
        return;
      }
      
      attempts++;
      setTimeout(checkButton, 100);
    };
    
    setTimeout(checkButton, 100);
  });
}

// メニューを閉じる（Moreボタンを再度クリックするか、メニューの外側をクリック）
function closeMenu(moreButton?: HTMLElement | null): void {
  // 方法1: Moreボタンを再度クリック（メニューを開いたボタンを再度クリックすると閉じる）
  if (moreButton) {
    moreButton.click();
    return;
  }
  
  // 方法2: メニュー要素の外側をクリック
  const menu = document.querySelector('[role="menu"]');
  if (menu) {
    const rect = menu.getBoundingClientRect();
    // メニューの左上の外側をクリック
    const clickX = Math.max(0, rect.left - 10);
    const clickY = Math.max(0, rect.top - 10);
    
    const elementBelow = document.elementFromPoint(clickX, clickY);
    if (elementBelow && elementBelow !== menu && !menu.contains(elementBelow)) {
      (elementBelow as HTMLElement).click();
      return;
    }
    
    // メニューの右下の外側をクリック
    const clickX2 = rect.right + 10;
    const clickY2 = rect.bottom + 10;
    const elementBelow2 = document.elementFromPoint(clickX2, clickY2);
    if (elementBelow2 && elementBelow2 !== menu && !menu.contains(elementBelow2)) {
      (elementBelow2 as HTMLElement).click();
      return;
    }
  }
  
  // 方法3: 画面の左上の要素をクリック
  const topLeftElement = document.elementFromPoint(10, 10);
  if (topLeftElement && topLeftElement !== document.body) {
    (topLeftElement as HTMLElement).click();
  }
}

// メニューを開いて、フォロー状態を判定し、必要に応じて非表示にする
function checkAndDismissTweet(tweetElement: HTMLElement, reason: string): Promise<boolean> {
  return new Promise((resolve) => {
    const accountName = getAccountName(tweetElement);
    console.log(`[DEBUG] Checking and potentially dismissing @${accountName || 'unknown'}: ${reason}`);
    
    // Moreボタンを探す
    let moreBtn = tweetElement.querySelector('[aria-label="More"]') || 
                   tweetElement.querySelector('[aria-label="その他"]') ||
                   tweetElement.querySelector('[data-testid="caret"]');
    
    if (!moreBtn) {
      const allButtons = Array.from(tweetElement.querySelectorAll('button, div[role="button"]'));
      moreBtn = allButtons.find(btn => {
        const label = btn.getAttribute('aria-label') || '';
        return /More|その他/i.test(label);
      }) as HTMLElement | null;
    }
    
    if (!moreBtn) {
      console.log(`[DEBUG] @${accountName || 'unknown'}: More button not found, defaulting to following`);
      resolve(false); // ボタンが見つからない場合は「フォローしている」と判定（表示する）
      return;
    }
    
    // メニューを開く
    console.log(`[DEBUG] Opening menu for @${accountName || 'unknown'}`);
    (moreBtn as HTMLElement).click();
    
    // メニューが表示されるまで待つ（ポーリングで確認）
    let attempts = 0;
    const maxAttempts = 20; // 最大2秒待つ（100ms × 20）
    
    const checkMenu = () => {
      const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
      
      if (menuItems.length > 0 || attempts >= maxAttempts) {
        console.log(`[DEBUG] Found ${menuItems.length} menu items for @${accountName || 'unknown'} (attempts: ${attempts})`);
        
        if (menuItems.length > 0) {
          console.log(`[DEBUG] Menu items:`, menuItems.map(item => item.innerText?.substring(0, 50)));
        }
        
        // メニュー項目を確認
        // 「Xさんのフォローを解除」→ フォローしている
        // 「Xさんをフォロー」→ フォローしていない
        
        const unfollowItem = menuItems.find(item => {
          const text = item.innerText || '';
          return /フォローを解除|Unfollow/i.test(text);
        });
        
        if (unfollowItem) {
          console.log(`[DEBUG] @${accountName || 'unknown'}: Following (found "Unfollow" menu item)`);
          console.log(`[DEBUG] Menu item text: "${unfollowItem.innerText?.substring(0, 50)}"`);
          // メニューを閉じる（Moreボタンを再度クリック）
          closeMenu(moreBtn as HTMLElement);
          setTimeout(() => resolve(false), 300); // フォローしている → 表示
          return;
        }
        
        const followItem = menuItems.find(item => {
          const text = item.innerText || '';
          // 「フォロー」を含むが「フォローを解除」を含まない
          return /フォロー|Follow/i.test(text) && !/フォローを解除|Unfollow/i.test(text);
        });
        
        if (followItem) {
          console.log(`[DEBUG] @${accountName || 'unknown'}: Not following (found "Follow" menu item)`);
          console.log(`[DEBUG] Menu item text: "${followItem.innerText?.substring(0, 50)}"`);
          
          // フォローしていない場合、「興味がない」メニュー項目を探してクリック
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
            
            // 「このポストは関連性がありません」ボタンが表示されるまで待ってクリック
            clickRelevanceButton(tweetElement, accountName).then(() => {
              setTimeout(() => resolve(true), 300); // 非表示にした
            });
            return;
          } else {
            console.warn(`[DEBUG] "Not interested" menu item not found`);
            // メニューを閉じる
            closeMenu(moreBtn as HTMLElement);
            setTimeout(() => resolve(true), 300); // フォローしていないが、メニュー項目が見つからなかった
            return;
          }
        }
        
        // メニュー項目が見つからない場合
        console.log(`[DEBUG] @${accountName || 'unknown'}: No follow/unfollow menu items found`);
        // メニューを閉じる
        closeMenu(moreBtn as HTMLElement);
        setTimeout(() => resolve(false), 300); // デフォルトで「フォローしている」と判定（表示する）
      } else {
        attempts++;
        setTimeout(checkMenu, 100);
      }
    };
    
    setTimeout(checkMenu, 100);
  });
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

// リツイートの場合、メニューを開いて判定し、必要に応じて非表示にする
async function checkAndDismissRetweet(tweetElement: HTMLElement, reason: string): Promise<boolean> {
  // リツイートでない場合は、この関数では処理しない
  if (!isRetweet(tweetElement)) {
    return false;
  }
  
  // リツイートした人のアカウント名を取得
  const retweeterName = getAccountName(tweetElement);
  console.log(`[DEBUG] Retweeter: @${retweeterName || 'unknown'}`);
  
  // リツイートした人がフォローしているかどうかをチェック（メニューを開いて判定し、必要に応じて非表示）
  const shouldDismiss = await checkAndDismissTweet(tweetElement, reason);
  console.log(`[DEBUG] Retweeter @${retweeterName || 'unknown'} should dismiss: ${shouldDismiss}`);
  
  return shouldDismiss;
}


function scanTweets(): void {
  try {
    // 「おすすめ」タブでない場合は処理しない
    if (!isRecommendedTab()) {
      return;
    }
    
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
    
    // 処理対象のツイートを収集（処理済みでない、すべてのツイートを先読み）
    const tweetsToProcess: HTMLElement[] = [];
    
    tweetArticles.forEach((article) => {
      const tweetEl = article as HTMLElement;
      
      // すでに処理済みのツイートはスキップ
      if (processedTweets.has(tweetEl)) {
        return;
      }
      
      // すべてのツイートを処理対象に追加（ビューポート外も含む）
      tweetsToProcess.push(tweetEl);
    });
    
    console.log(`[DEBUG] Found ${tweetsToProcess.length} tweets to process`);
    
    if (tweetsToProcess.length === 0) {
      closePremiumPlusModal();
      return;
    }
    
    // 処理開始
    isProcessing = true;
    lastProcessTime = Date.now();
    console.log(`[DEBUG] Starting to process ${tweetsToProcess.length} tweets in parallel`);
    
    // すべてのツイートを並列で処理（メニュー操作はキューで管理）
    processTweetsInParallel(tweetsToProcess).catch((error) => {
      console.error('Error in processTweetsInParallel:', error);
      isProcessing = false;
      // エラーが発生しても再開できるようにする
      setTimeout(() => scanTweets(), 1000);
    });
  } catch (error) {
    console.error('Error in scanTweets:', error);
    isProcessing = false;
  }
}

// メニュー操作のキュー（同時に1つずつしか実行できない）
const menuQueue: Array<{ tweet: HTMLElement; isRetweet: boolean; reason: string }> = [];
let isProcessingMenu = false;

// メニュー操作をキューに追加して順番に処理
async function processMenuQueue(): Promise<void> {
  if (isProcessingMenu || menuQueue.length === 0) {
    return;
  }
  
  isProcessingMenu = true;
  const item = menuQueue.shift();
  if (!item) {
    isProcessingMenu = false;
    return;
  }
  
  try {
    const { tweet, isRetweet, reason } = item;
    const accountName = getAccountName(tweet);
    
    if (isRetweet) {
      await checkAndDismissRetweet(tweet, reason);
    } else {
      await checkAndDismissTweet(tweet, reason);
    }
    
    processedTweets.add(tweet);
  } catch (error) {
    console.error('Error processing menu queue:', error);
  }
  
  // 次のメニュー操作を処理（少し待ってから）
  setTimeout(() => {
    isProcessingMenu = false;
    processMenuQueue();
  }, 800);
}

// ツイートを一時的に非表示にする
function hideTweet(tweetEl: HTMLElement): void {
  if (hiddenTweets.has(tweetEl)) {
    return; // 既に非表示
  }
  
  const style = window.getComputedStyle(tweetEl);
  hiddenTweets.set(tweetEl, {
    display: style.display,
    visibility: style.visibility
  });
  
  // 即座に非表示
  (tweetEl as HTMLElement).style.display = 'none';
}

// ツイートを再表示する
function showTweet(tweetEl: HTMLElement): void {
  const saved = hiddenTweets.get(tweetEl);
  if (saved) {
    (tweetEl as HTMLElement).style.display = saved.display;
    (tweetEl as HTMLElement).style.visibility = saved.visibility;
    hiddenTweets.delete(tweetEl);
  }
}

// 複数のツイートを並列で処理
async function processTweetsInParallel(tweets: HTMLElement[]): Promise<void> {
  // 非表示処理は削除（描画を阻害しない）
  
  const promises: Promise<void>[] = [];
  
  for (const tweetEl of tweets) {
    // すでに処理済みのツイートはスキップ
    if (processedTweets.has(tweetEl)) {
      continue;
    }
    
    const promise = (async () => {
      try {
        const accountName = getAccountName(tweetEl);
        console.log(`[DEBUG] Processing tweet: @${accountName || 'unknown'}`);
        
        // プロモーションツイートの処理（メニュー操作不要なので即座に処理）
        const isPromo = isPromoted(tweetEl);
        if (isPromo) {
          const text = tweetEl.innerText;
          if (shouldDismiss(text)) {
            console.log(`[DEBUG] @${accountName || 'unknown'}: Promoted tweet, muting...`);
            muteAccount(tweetEl);
            processedTweets.add(tweetEl);
            // 非表示のまま（ミュートされるので）
            return;
          }
        }
        
        // リツイートかどうかを確認
        const isRT = isRetweet(tweetEl);
        
        // メニュー操作が必要な場合はキューに追加
        if (isRT) {
          menuQueue.push({ tweet: tweetEl, isRetweet: true, reason: "リツイート（フォローしていないアカウント）" });
        } else {
          menuQueue.push({ tweet: tweetEl, isRetweet: false, reason: "フォローしていないアカウント" });
        }
        
        // メニューキューを処理開始
        processMenuQueue();
      } catch (error) {
        console.error('Error processing tweet:', error);
      }
    })();
    
    promises.push(promise);
  }
  
  // すべての処理が完了するまで待機
  await Promise.all(promises);
  
  // メニューキューが空になるまで待機
  while (menuQueue.length > 0 || isProcessingMenu) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // 非表示処理を削除したため、再表示処理も不要
  
  console.log(`[DEBUG] Finished processing ${tweets.length} tweets`);
  isProcessing = false;
  lastProcessTime = Date.now();
  closePremiumPlusModal();
  
  // 処理完了後、未処理のツイートがあれば再開
  setTimeout(() => {
    if (!isProcessing && isRecommendedTab()) {
      const tweetArticles = document.querySelectorAll('article');
      const unprocessedTweets = Array.from(tweetArticles).filter(
        article => !processedTweets.has(article as HTMLElement)
      );
      
      if (unprocessedTweets.length > 0) {
        console.log(`[DEBUG] Found ${unprocessedTweets.length} unprocessed tweets after completion, resuming`);
        scanTweets();
      }
    }
  }, 1000);
}

// MutationObserverで動的追加にも対応（描画更新を検出して処理）
const observer = new MutationObserver((mutations) => {
  // 「おすすめ」タブでない場合は処理しない
  if (!isRecommendedTab()) {
    return;
  }
  
  // article要素が追加された瞬間を検出
  let hasNewTweets = false;
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as HTMLElement;
          // article要素またはarticle要素を含む要素が追加された
          if (element.tagName === 'ARTICLE' || element.querySelector('article')) {
            hasNewTweets = true;
            break;
          }
        }
      }
    }
    if (hasNewTweets) break;
  }
  
  // 新しいツイートが見つかった場合、処理を開始（非表示はprocessTweetsInParallel内で実行）
  if (hasNewTweets && !scrollTimeout) {
    // より早く処理するため、待機時間を短縮
    scrollTimeout = setTimeout(() => {
      scanTweets();
      scrollTimeout = null;
    }, 50);
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
  // 「おすすめ」タブでない場合は処理しない
  if (!isRecommendedTab()) {
    return;
  }
  
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
  
  // ウォッチドッグを開始（処理が止まらないように監視）
  startWatchdog();
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try {
        setTimeout(() => scanTweets(), 1000);
      } catch (error) {
        console.error('Error in DOMContentLoaded handler:', error);
        isProcessing = false;
      }
    });
  } else {
    try {
      setTimeout(() => scanTweets(), 1000);
    } catch (error) {
      console.error('Error in initial scanTweets:', error);
      isProcessing = false;
    }
  }
} catch (error) {
  console.error('Error initializing extension:', error);
  console.error('Error details:', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  isProcessing = false;
}

