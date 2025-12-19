// スクロールタイムアウトの管理用変数
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

// 処理済みのツイートを記録（グローバル）
const processedTweets = new Set<HTMLElement>();

// 処理中フラグを削除：一切止まらないようにするため

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
    
    // 常に未処理のツイートをチェックして処理を開始（一切止まらないようにする）
    // ビューポート内のツイートを優先的に処理
    const tweetArticles = document.querySelectorAll('article');
    const unprocessedTweetsInViewport = Array.from(tweetArticles).filter(
      article => {
        const tweetEl = article as HTMLElement;
        return !processedTweets.has(tweetEl) && isInViewport(tweetEl);
      }
    );
    
    const unprocessedTweetsOutOfViewport = Array.from(tweetArticles).filter(
      article => {
        const tweetEl = article as HTMLElement;
        return !processedTweets.has(tweetEl) && !isInViewport(tweetEl);
      }
    );
    
    if (unprocessedTweetsInViewport.length > 0 || unprocessedTweetsOutOfViewport.length > 0) {
      console.log(`[DEBUG] Watchdog: Found ${unprocessedTweetsInViewport.length} in viewport, ${unprocessedTweetsOutOfViewport.length} out of viewport, processing immediately`);
      lastProcessTime = now;
      scanTweets();
    }
  }, 200); // 200msごとにチェック（一切止まらないようにする）
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
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  
  // 部分的にでもビューポート内にある要素を検出（より緩い条件）
  // 要素の一部がビューポート内にあればtrue
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < viewportHeight &&
    rect.left < viewportWidth
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
    
    // タイムアウトを設定（10秒で強制解決）
    const timeoutId = setTimeout(() => {
      console.warn(`[DEBUG] @${accountName || 'unknown'}: Timeout in checkAndDismissTweet, resolving as false`);
      resolve(false);
    }, 10000);
    
    // 解決時にタイムアウトをクリアする関数
    const safeResolve = (value: boolean) => {
      clearTimeout(timeoutId);
      resolve(value);
    };
    
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
      safeResolve(false); // ボタンが見つからない場合は「フォローしている」と判定（表示する）
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
          setTimeout(() => safeResolve(false), 300); // フォローしている → 表示
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
              setTimeout(() => safeResolve(true), 300); // 非表示にした
            }).catch((error) => {
              console.error(`[DEBUG] Error in clickRelevanceButton:`, error);
              setTimeout(() => safeResolve(true), 300); // エラーでも続行
            });
            return;
          } else {
            console.warn(`[DEBUG] "Not interested" menu item not found`);
            // メニューを閉じる
            closeMenu(moreBtn as HTMLElement);
            setTimeout(() => safeResolve(true), 300); // フォローしていないが、メニュー項目が見つからなかった
            return;
          }
        }
        
        // メニュー項目が見つからない場合
        console.log(`[DEBUG] @${accountName || 'unknown'}: No follow/unfollow menu items found`);
        // メニューを閉じる
        closeMenu(moreBtn as HTMLElement);
        setTimeout(() => safeResolve(false), 300); // デフォルトで「フォローしている」と判定（表示する）
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
    
    // ビューポート内の未処理ツイートのみを優先的に処理（軽量化）
    const tweetArticles = Array.from(document.querySelectorAll('article')) as HTMLElement[];
    const tweetsInViewport: HTMLElement[] = [];
    
    // ビューポート内のツイートのみを収集（最大20件まで）
    let count = 0;
    for (const tweetEl of tweetArticles) {
      if (count >= 20) break; // 一度に処理するツイート数を制限
      
      // すでに処理済みのツイートはスキップ
      if (processedTweets.has(tweetEl)) {
        continue;
      }
      
      // ビューポート内のツイートのみを処理
      if (isInViewport(tweetEl)) {
        tweetsInViewport.push(tweetEl);
        count++;
      }
    }
    
    if (tweetsInViewport.length > 0) {
      lastProcessTime = Date.now();
      console.log(`[DEBUG] Processing ${tweetsInViewport.length} tweets in viewport (priority, non-blocking)`);
      
      // 非ブロッキングで処理を開始（完了を待たない）
      processTweetsInParallel(tweetsInViewport).catch((error) => {
        console.error('Error in processTweetsInParallel (viewport):', error);
      });
    }
    
    // ビューポート外のツイートは別途処理（バッチ処理）
    // すぐに次のスキャンを開始できるように、非同期で処理
    setTimeout(() => {
      const tweetsOutOfViewport: HTMLElement[] = [];
      let outCount = 0;
      
      for (const tweetEl of tweetArticles) {
        if (outCount >= 10) break; // ビューポート外は一度に10件まで
        
        if (processedTweets.has(tweetEl)) {
          continue;
        }
        
        if (!isInViewport(tweetEl)) {
          tweetsOutOfViewport.push(tweetEl);
          outCount++;
        }
      }
      
      if (tweetsOutOfViewport.length > 0) {
        console.log(`[DEBUG] Processing ${tweetsOutOfViewport.length} tweets out of viewport (background)`);
        processTweetsInParallel(tweetsOutOfViewport).catch((error) => {
          console.error('Error in processTweetsInParallel (out of viewport):', error);
        });
      }
    }, 200); // 200ms後にバックグラウンド処理
    
    // すぐに次のスキャンを開始（処理完了を待たない）
    setTimeout(() => scanTweets(), 300); // 300ms後に次のスキャン
  } catch (error) {
    console.error('Error in scanTweets:', error);
    // エラーが発生しても即座に再開
    setTimeout(() => scanTweets(), 100);
  }
}

// メニュー操作のキュー（同時に1つずつしか実行できない）
const menuQueue: Array<{ tweet: HTMLElement; isRetweet: boolean; reason: string }> = [];
let isProcessingMenu = false;

// メニューキューの処理を確実に開始するためのウォッチドッグ
function startMenuQueueWatchdog(): void {
  setInterval(() => {
    if (!isRecommendedTab()) {
      return;
    }
    
    // メニューキューにアイテムがあり、処理中でない場合は処理を開始
    if (menuQueue.length > 0 && !isProcessingMenu) {
      console.log(`[DEBUG] Menu queue watchdog: Found ${menuQueue.length} items, starting processing`);
      processMenuQueue().catch((error) => {
        console.error('[DEBUG] Menu queue watchdog: Error starting processing:', error);
        isProcessingMenu = false;
      });
    }
  }, 200); // 200msごとにチェック
}

// メニュー操作をキューに追加して順番に処理
async function processMenuQueue(): Promise<void> {
  if (isProcessingMenu) {
    console.log(`[DEBUG] Menu queue: Already processing, queue length: ${menuQueue.length}`);
    return;
  }
  
  if (menuQueue.length === 0) {
    return;
  }
  
  isProcessingMenu = true;
  const item = menuQueue.shift();
  if (!item) {
    isProcessingMenu = false;
    return;
  }
  
  const queueLength = menuQueue.length;
  console.log(`[DEBUG] Menu queue: Processing item, remaining in queue: ${queueLength}`);
  
  try {
    const { tweet, isRetweet, reason } = item;
    const accountName = getAccountName(tweet);
    console.log(`[DEBUG] Menu queue: Processing @${accountName || 'unknown'}, isRetweet: ${isRetweet}, reason: ${reason}`);
    
    if (isRetweet) {
      await checkAndDismissRetweet(tweet, reason);
    } else {
      await checkAndDismissTweet(tweet, reason);
    }
    
    processedTweets.add(tweet);
    console.log(`[DEBUG] Menu queue: Completed processing @${accountName || 'unknown'}`);
  } catch (error) {
    console.error('Error processing menu queue:', error);
  }
  
  // 次のメニュー操作を処理（少し待ってから）
  setTimeout(() => {
    isProcessingMenu = false;
    // 確実に次の処理を開始
    if (menuQueue.length > 0) {
      console.log(`[DEBUG] Menu queue: Continuing with ${menuQueue.length} items remaining`);
      // 即座に次の処理を開始（ウォッチドッグに任せない）
      processMenuQueue().catch((error) => {
        console.error('[DEBUG] Error in processMenuQueue continuation:', error);
        // エラーが発生してもフラグをリセットして再試行
        isProcessingMenu = false;
        // ウォッチドッグが拾うように少し待つ
        setTimeout(() => {
          if (menuQueue.length > 0 && !isProcessingMenu) {
            processMenuQueue();
          }
        }, 100);
      });
    } else {
      console.log(`[DEBUG] Menu queue: Queue is empty, processing complete`);
    }
  }, 200); // 300msから200msに短縮（より高速に処理）
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
      let accountName: string | null = null;
      try {
        accountName = getAccountName(tweetEl);
      } catch (error) {
        console.error('[DEBUG] Error getting account name:', error);
      }
      
      try {
        console.log(`[DEBUG] Processing tweet: @${accountName || 'unknown'}`);
      } catch (error) {
        console.error('[DEBUG] Error in first console.log:', error);
      }
      
      try {
        console.log(`[DEBUG] @${accountName || 'unknown'}: Promise started`);
      } catch (error) {
        console.error('[DEBUG] Error in second console.log:', error);
      }
      
      try {
        // プロモーションツイートの処理（メニュー操作不要なので即座に処理）
        console.log(`[DEBUG] @${accountName || 'unknown'}: Checking if promoted...`);
        let isPromo = false;
        try {
          isPromo = isPromoted(tweetEl);
        } catch (error) {
          console.error(`[DEBUG] @${accountName || 'unknown'}: Error in isPromoted:`, error);
        }
        console.log(`[DEBUG] @${accountName || 'unknown'}: Is promoted: ${isPromo}`);
        
        if (isPromo) {
          const text = tweetEl.innerText;
          if (shouldDismiss(text)) {
            console.log(`[DEBUG] @${accountName || 'unknown'}: Promoted tweet, muting...`);
            muteAccount(tweetEl);
            processedTweets.add(tweetEl);
            // 非表示のまま（ミュートされるので）
            return;
          }
          console.log(`[DEBUG] @${accountName || 'unknown'}: Promoted but not dismissing`);
        }
        
        // リツイートかどうかを確認
        console.log(`[DEBUG] @${accountName || 'unknown'}: Checking if retweet...`);
        let isRT = false;
        try {
          isRT = isRetweet(tweetEl);
        } catch (error) {
          console.error(`[DEBUG] @${accountName || 'unknown'}: Error in isRetweet:`, error);
        }
        console.log(`[DEBUG] @${accountName || 'unknown'}: Is retweet: ${isRT}`);
        
        // メニュー操作が必要な場合はキューに追加
        if (isRT) {
          menuQueue.push({ tweet: tweetEl, isRetweet: true, reason: "リツイート（フォローしていないアカウント）" });
          console.log(`[DEBUG] Added retweet to menu queue: @${accountName || 'unknown'}, queue length: ${menuQueue.length}`);
        } else {
          menuQueue.push({ tweet: tweetEl, isRetweet: false, reason: "フォローしていないアカウント" });
          console.log(`[DEBUG] Added tweet to menu queue: @${accountName || 'unknown'}, queue length: ${menuQueue.length}`);
        }
        
        // メニューキューを処理開始
        console.log(`[DEBUG] @${accountName || 'unknown'}: Starting menu queue processing...`);
        try {
          processMenuQueue().catch((error) => {
            console.error(`[DEBUG] Error in processMenuQueue:`, error);
          });
        } catch (error) {
          console.error(`[DEBUG] Error calling processMenuQueue:`, error);
        }
        console.log(`[DEBUG] @${accountName || 'unknown'}: Finished processing setup`);
      } catch (error) {
        console.error(`[DEBUG] Error processing tweet @${accountName || 'unknown'}:`, error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      }
    })();
    
    promises.push(promise);
    console.log(`[DEBUG] Added promise to array, total promises: ${promises.length}`);
  }
  
  // 非ブロッキング：promiseの完了を待たずに即座に返す
  // メニューキューの処理は別途継続的に実行される
  console.log(`[DEBUG] Started ${promises.length} promises (non-blocking)`);
  
  // バックグラウンドでpromiseの完了を待つ（エラーをログに記録するだけ）
  Promise.allSettled(promises).then(() => {
    console.log(`[DEBUG] All ${promises.length} promises settled`);
  }).catch((error) => {
    console.error(`[DEBUG] Error in Promise.allSettled:`, error);
  });
  
  // メニューキューを確実に処理開始（非ブロッキング）
  if (menuQueue.length > 0) {
    console.log(`[DEBUG] Ensuring menu queue processing starts, queue length: ${menuQueue.length}`);
    processMenuQueue().catch((error) => {
      console.error(`[DEBUG] Error in processMenuQueue call:`, error);
    });
  }
  
  // 非ブロッキング：メニューキューの完了を待たない
  // メニューキューの処理は別途継続的に実行される
  console.log(`[DEBUG] Finished setting up ${tweets.length} tweets (non-blocking)`);
  lastProcessTime = Date.now();
}

// MutationObserverで動的追加にも対応（描画更新を検出して処理）
const observer = new MutationObserver((mutations) => {
  // 「おすすめ」タブでない場合は処理しない
  if (!isRecommendedTab()) {
    return;
  }
  
  // article要素が追加された瞬間を検出（より積極的に検出）
  let hasNewTweets = false;
  const newArticles: HTMLElement[] = [];
  
  console.log(`[DEBUG] MutationObserver: Received ${mutations.length} mutations`);
  
  for (const mutation of mutations) {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      console.log(`[DEBUG] MutationObserver: Found ${mutation.addedNodes.length} added nodes`);
      
      for (const node of Array.from(mutation.addedNodes)) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as HTMLElement;
          
          // article要素が直接追加された場合
          if (element.tagName === 'ARTICLE') {
            if (!processedTweets.has(element)) {
              newArticles.push(element);
              hasNewTweets = true;
              console.log(`[DEBUG] MutationObserver: Found new article element directly`);
            }
          }
          // article要素を含む要素が追加された場合
          else {
            const articles = element.querySelectorAll('article');
            if (articles.length > 0) {
              console.log(`[DEBUG] MutationObserver: Found ${articles.length} article elements in added node`);
            }
            for (const article of Array.from(articles)) {
              const articleEl = article as HTMLElement;
              if (!processedTweets.has(articleEl)) {
                newArticles.push(articleEl);
                hasNewTweets = true;
                console.log(`[DEBUG] MutationObserver: Found new article element in subtree`);
              }
            }
          }
        }
      }
    }
  }
  
  // 新しいツイートが見つかった場合、即座に処理を開始（プッシュ通知で読み込まれたツイートにも対応）
  if (hasNewTweets) {
    console.log(`[DEBUG] MutationObserver: ${newArticles.length} new tweets detected, processing immediately`);
    
    // 新しいツイートを即座に処理
    if (newArticles.length > 0) {
      // ビューポート内のツイートを優先
      const inViewport = newArticles.filter(el => isInViewport(el));
      const outOfViewport = newArticles.filter(el => !isInViewport(el));
      
      console.log(`[DEBUG] MutationObserver: ${inViewport.length} in viewport, ${outOfViewport.length} out of viewport`);
      
      if (inViewport.length > 0) {
        console.log(`[DEBUG] MutationObserver: Processing ${inViewport.length} new tweets in viewport immediately`);
        lastProcessTime = Date.now();
        // スクロール中かどうかに関わらず、ビューポート内のツイートは即座に処理
        processTweetsInParallel(inViewport).catch((error) => {
          console.error('[DEBUG] MutationObserver: Error processing new tweets in viewport:', error);
        });
      }
      
      // スクロール中の場合、ビューポート外のツイートも即座にチェック（スクロールで表示される可能性がある）
      if (isScrolling && outOfViewport.length > 0) {
        // スクロール中は、ビューポート外のツイートも少し待ってから処理（スクロールで表示される可能性がある）
        setTimeout(() => {
          // 再度ビューポート判定（スクロールで表示された可能性がある）
          const nowInViewport = outOfViewport.filter(el => isInViewport(el));
          if (nowInViewport.length > 0) {
            console.log(`[DEBUG] MutationObserver: ${nowInViewport.length} tweets moved into viewport during scroll, processing immediately`);
            lastProcessTime = Date.now();
            processTweetsInParallel(nowInViewport).catch((error) => {
              console.error('[DEBUG] MutationObserver: Error processing tweets moved into viewport:', error);
            });
          }
        }, 50); // 50ms後に再チェック
      }
      
      if (outOfViewport.length > 0) {
        console.log(`[DEBUG] MutationObserver: Scheduling processing of ${outOfViewport.length} new tweets out of viewport`);
        setTimeout(() => {
          console.log(`[DEBUG] MutationObserver: Processing ${outOfViewport.length} new tweets out of viewport`);
          lastProcessTime = Date.now();
          processTweetsInParallel(outOfViewport).catch((error) => {
            console.error('[DEBUG] MutationObserver: Error processing new tweets out of viewport:', error);
          });
        }, 100); // 500msから100msに短縮
      }
    }
    
    // 念のため、全体のスキャンも実行
    console.log(`[DEBUG] MutationObserver: Scheduling scanTweets() in 100ms`);
    setTimeout(() => {
      console.log(`[DEBUG] MutationObserver: Calling scanTweets() now`);
      scanTweets();
    }, 100);
  } else {
    console.log(`[DEBUG] MutationObserver: No new tweets found in this mutation batch`);
  }
});

// document.bodyが存在する場合のみobserverを設定
// より積極的に監視するため、複数の要素を監視
function setupObserver(): void {
  if (document.body) {
    // メインのタイムラインコンテナを探す
    const timeline = document.querySelector('[data-testid="primaryColumn"]') || 
                     document.querySelector('main') ||
                     document.body;
    
    // 既存の監視を停止してから再設定
    observer.disconnect();
    
    observer.observe(timeline, { 
      childList: true, 
      subtree: true,
      attributes: false,
      characterData: false
    });
    
    console.log('[DEBUG] MutationObserver: Started observing', timeline);
    
    // 定期的にobserverが動作しているか確認し、必要に応じて再設定
    setInterval(() => {
      if (!isRecommendedTab()) {
        return;
      }
      
      // observerが正しく設定されているか確認
      const currentTimeline = document.querySelector('[data-testid="primaryColumn"]') || 
                               document.querySelector('main') ||
                               document.body;
      
      // 念のため、定期的にスキャンも実行（MutationObserverが発火しない場合のフォールバック）
      console.log('[DEBUG] Periodic scan check (fallback if MutationObserver fails)');
      scanTweets();
    }, 2000); // 2秒ごとにフォールバックスキャン
  } else {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setupObserver();
      });
    } else {
      setTimeout(setupObserver, 1000);
    }
  }
}

setupObserver();

// ページ遷移時にもobserverを再設定
let lastUrl = window.location.href;
setInterval(() => {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    console.log('[DEBUG] URL changed, re-setting up observer');
    lastUrl = currentUrl;
    setTimeout(() => {
      setupObserver();
    }, 1000);
  }
}, 1000);

// スクロール中に新しく表示されたツイートを即座に処理
let isScrolling = false;
let scrollCheckInterval: ReturnType<typeof setInterval> | null = null;

// スクロールイベント：スクロール中は定期的にビューポート内のツイートをチェック
window.addEventListener('scroll', () => {
  // 「おすすめ」タブでない場合は処理しない
  if (!isRecommendedTab()) {
    return;
  }
  
  // スクロール開始を検出
  if (!isScrolling) {
    isScrolling = true;
    console.log('[DEBUG] Scroll started, starting continuous viewport check');
    
    // 即座に1回チェック
    scanTweetsInViewportImmediate();
    
    // スクロール中は100msごとにビューポート内のツイートをチェック
    if (scrollCheckInterval) {
      clearInterval(scrollCheckInterval);
    }
    scrollCheckInterval = setInterval(() => {
      if (isScrolling && isRecommendedTab()) {
        scanTweetsInViewportImmediate();
      } else {
        if (scrollCheckInterval) {
          clearInterval(scrollCheckInterval);
          scrollCheckInterval = null;
        }
      }
    }, 100); // 100msごとにチェック
  }
  
  // スクロール停止を検出（200ms後に停止とみなす）
  if (scrollTimeout) {
    clearTimeout(scrollTimeout);
  }
  scrollTimeout = setTimeout(() => {
    isScrolling = false;
    if (scrollCheckInterval) {
      clearInterval(scrollCheckInterval);
      scrollCheckInterval = null;
    }
    console.log('[DEBUG] Scroll stopped');
    scrollTimeout = null;
  }, 200);
}, { passive: true });

// ビューポート内のツイートを即座にスキャン（スクロール中専用、高速処理）
function scanTweetsInViewportImmediate(): void {
  try {
    if (!isRecommendedTab()) {
      return;
    }
    
    // ビューポート内の未処理ツイートのみを即座に処理
    const tweetArticles = Array.from(document.querySelectorAll('article')) as HTMLElement[];
    const tweetsInViewport: HTMLElement[] = [];
    
    // ビューポート内の未処理ツイートを収集
    for (const tweetEl of tweetArticles) {
      // すでに処理済みのツイートはスキップ
      if (processedTweets.has(tweetEl)) {
        continue;
      }
      
      // ビューポート内かどうかを判定（isInViewportを使用）
      if (isInViewport(tweetEl)) {
        tweetsInViewport.push(tweetEl);
      }
    }
    
    if (tweetsInViewport.length > 0) {
      lastProcessTime = Date.now();
      console.log(`[DEBUG] Scroll: Found ${tweetsInViewport.length} new tweets in viewport, processing immediately`);
      
      // 即座に処理を開始
      processTweetsInParallel(tweetsInViewport).catch((error) => {
        console.error('Error in processTweetsInParallel (scroll viewport):', error);
      });
      
      // メニューキューの処理を確実に開始
      if (menuQueue.length > 0) {
        console.log(`[DEBUG] Scroll: Starting menu queue processing, queue length: ${menuQueue.length}`);
        processMenuQueue().catch((error) => {
          console.error('Error in processMenuQueue (scroll):', error);
        });
      }
    }
  } catch (error) {
    console.error('Error in scanTweetsInViewportImmediate:', error);
  }
}

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

