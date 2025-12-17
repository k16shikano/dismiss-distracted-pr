// スクロールタイムアウトの管理用変数
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

// 処理済みのツイートを記録（グローバル）
const processedTweets = new Set<HTMLElement>();

// 処理中フラグ（同時に複数のツイートを処理しないようにする）
let isProcessing = false;

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
  const isPromoted = tweetElement.innerText.includes("プロモーション");
  console.log('Tweet content:', tweetElement.innerText);
  console.log('Is promoted:', isPromoted);
  return isPromoted;
}

function getAccountName(tweetElement: HTMLElement): string | null {
  const accountLink = tweetElement.querySelector('a[role="link"]');
  if (!accountLink) {
    console.log('Account link not found');
    return null;
  }
  
  const href = accountLink.getAttribute('href');
  const accountName = href ? href.substring(1) : null;
  console.log('Found account:', accountName);
  return accountName;
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
  const shouldMute = reasons.length >= 2;
  
  if (reasons.length > 0) {
    console.log('検出された条件:', reasons.join('、'));
    console.log('ミュート判定:', shouldMute ? 'ミュートします' : 'スキップします');
  }
  
  return shouldMute;
}

function closePremiumPlusModal() {
  // モーダルの特徴的なテキストやクラス名で検出
  const modal = Array.from(document.querySelectorAll('[role="dialog"], [data-testid="sheetDialog"]'))
    .find(el => el.textContent?.includes("プレミアムプラス") || el.textContent?.includes("Premium+"));
  if (modal) {
    // 閉じるボタンを探してクリック
    const closeBtn = modal.querySelector('div[aria-label="閉じる"], div[aria-label="Close"]');
    if (closeBtn) {
      (closeBtn as HTMLElement).click();
      console.log("プレミアムプラスのモーダルを自動で閉じました");
    } else {
      // ボタンが見つからない場合は強制的に非表示
      (modal as HTMLElement).style.display = "none";
      console.log("プレミアムプラスのモーダルを強制的に非表示にしました");
    }
  }
}

function closeMuteToast() {
  // トーストの検出方法を改善
  const toasts = Array.from(document.querySelectorAll('[role="alert"], [data-testid="toast"], [data-testid="toastContainer"] div'));
  console.log('Found toasts:', toasts.map(t => t.textContent));
  
  const toast = toasts.find(el => {
    const text = el.textContent || '';
    return text.includes("ミュートしました") || 
           text.includes("muted") || 
           text.includes("取り消しますか");
  });
  
  if (toast) {
    console.log('Found mute toast:', toast.textContent);
    // トーストをクリックして閉じる
    (toast as HTMLElement).click();
    console.log("ミュート通知を自動で閉じました");
    
    // グレーアウトのオーバーレイを非表示
    const overlays = document.querySelectorAll('[role="presentation"]');
    overlays.forEach(overlay => {
      if (overlay instanceof HTMLElement) {
        overlay.style.display = "none";
        console.log("オーバーレイを非表示にしました");
      }
    });
  } else {
    console.log('No mute toast found');
  }
}

function muteAccount(tweetElement: HTMLElement): void {
  console.log('Attempting to mute account...');
  // 新しいセレクタを試す
  const moreBtn = tweetElement.querySelector('[aria-label="More"]') || 
                 tweetElement.querySelector('[aria-label="その他"]') ||
                 tweetElement.querySelector('[data-testid="caret"]');
  
  if (!moreBtn) {
    console.log('More button not found. Available elements:', 
      Array.from(tweetElement.querySelectorAll('*')).map(el => ({
        tag: el.tagName,
        ariaLabel: el.getAttribute('aria-label'),
        testId: el.getAttribute('data-testid')
      }))
    );
    return;
  }

  console.log('Clicking more button...');
  (moreBtn as HTMLElement).click();

  setTimeout(() => {
    const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
    console.log('Found menu items:', menuItems.map(item => item.innerText));
    
    const muteItem = menuItems.find(item => 
      item.innerText.includes("ミュート") || 
      item.innerText.includes("Mute")
    );
    if (muteItem) {
      console.log('Clicking mute button...');
      muteItem.click();
      console.log(`Muted account: ${getAccountName(tweetElement)}`);
      
      // ミュート後の通知を閉じる（複数回試行）
      setTimeout(closeMuteToast, 500);
      setTimeout(closeMuteToast, 1000);
      setTimeout(closeMuteToast, 1500);
    } else {
      console.log('Mute button not found in menu');
    }
  }, 300);
}

// フォローしていないアカウントかどうかを判定
function isNotFollowingAccount(tweetElement: HTMLElement): boolean {
  // フォローボタンを探す（複数のセレクタで試す）
  let followButton = tweetElement.querySelector('[data-testid="follow"]');
  
  if (!followButton) {
    // aria-labelで探す
    const buttons = Array.from(tweetElement.querySelectorAll('button, div[role="button"]'));
    const foundButton = buttons.find(btn => {
      const label = btn.getAttribute('aria-label') || '';
      return /フォロー|Follow/i.test(label) && !/フォロー中|Following/i.test(label);
    });
    followButton = foundButton ? foundButton as HTMLElement : null;
  }
  
  // テキスト内容でも確認（ボタン内のテキスト）
  if (!followButton) {
    const allButtons = Array.from(tweetElement.querySelectorAll('button, div[role="button"], span[role="button"]'));
    const foundButton = allButtons.find(btn => {
      const text = btn.textContent || '';
      return /^フォロー$|^Follow$/i.test(text.trim());
    });
    followButton = foundButton ? foundButton as HTMLElement : null;
  }
  
  const isNotFollowing = followButton !== null && followButton !== undefined;
  
  console.log('Checking if not following account:', {
    hasFollowButton: isNotFollowing,
    accountName: getAccountName(tweetElement)
  });
  
  return isNotFollowing;
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
  
  const isRT = retweetIndicator !== null || retweetIcon !== null || hasRetweetText;
  
  console.log('Checking if retweet:', {
    hasRetweetIndicator: retweetIndicator !== null,
    hasRetweetIcon: retweetIcon !== null,
    hasRetweetText: hasRetweetText,
    isRetweet: isRT
  });
  
  return isRT;
}

// フォローしている人からのリツイートではないかどうかを判定
function isNotRetweetFromFollowing(tweetElement: HTMLElement): boolean {
  // リツイートでない場合は、この関数では判定しない（isNotFollowingAccountで判定される）
  if (!isRetweet(tweetElement)) {
    return false;
  }
  
  // リツイートの場合、元のツイート主がフォローしているかどうかを判定
  // リツイート要素内に「フォロー」ボタンがある場合は、フォローしていないアカウントからのリツイート
  const followButtonInRetweet = tweetElement.querySelector('[data-testid="follow"]');
  
  if (!followButtonInRetweet) {
    // aria-labelでも確認
    const buttons = Array.from(tweetElement.querySelectorAll('button, div[role="button"]'));
    const followBtn = buttons.find(btn => {
      const label = btn.getAttribute('aria-label') || '';
      return /フォロー|Follow/i.test(label) && !/フォロー中|Following/i.test(label);
    });
    
    const isFromFollowing = followBtn === undefined;
    console.log('Checking if not retweet from following:', {
      isRetweet: true,
      hasFollowButton: followBtn !== undefined,
      isNotFromFollowing: !isFromFollowing
    });
    return !isFromFollowing;
  }
  
  console.log('Checking if not retweet from following:', {
    isRetweet: true,
    hasFollowButton: true,
    isNotFromFollowing: true
  });
  
  return true;
}

// 「興味がない」メニューをクリック
function dismissAsNotInterested(tweetElement: HTMLElement): void {
  console.log('Attempting to dismiss as not interested...');
  // 新しいセレクタを試す
  const moreBtn = tweetElement.querySelector('[aria-label="More"]') || 
                 tweetElement.querySelector('[aria-label="その他"]') ||
                 tweetElement.querySelector('[data-testid="caret"]');
  
  if (!moreBtn) {
    console.log('More button not found');
    return;
  }

  console.log('Clicking more button...');
  (moreBtn as HTMLElement).click();

  setTimeout(() => {
    const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
    console.log('Found menu items:', menuItems.map(item => item.innerText));
    
    const notInterestedItem = menuItems.find(item => 
      item.innerText.includes("興味がない") || 
      item.innerText.includes("Not interested") ||
      item.innerText.includes("Not interested in this")
    );
    if (notInterestedItem) {
      console.log('Clicking "Not interested" button...');
      notInterestedItem.click();
      console.log('Dismissed as not interested');
    } else {
      console.log('"Not interested" button not found in menu');
    }
  }, 300);
}

function scanTweets(): void {
  console.log('=== scanTweets() called ===');
  
  // 既に処理中の場合はスキップ
  if (isProcessing) {
    console.log('Already processing, skipping this scan...');
    return;
  }
  
  const tweetArticles = document.querySelectorAll('article');
  console.log(`Found ${tweetArticles.length} article elements`);
  
  if (tweetArticles.length === 0) {
    console.log('No tweets found, waiting for content to load...');
    return;
  }
  
  // 処理対象のツイートを収集（処理済みでない、ビューポート内のもの）
  const tweetsToProcess: HTMLElement[] = [];
  
  tweetArticles.forEach((article, index) => {
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
  
  console.log(`Found ${tweetsToProcess.length} tweets to process`);
  
  if (tweetsToProcess.length === 0) {
    console.log('No new tweets to process');
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
    console.log(`=== All ${tweets.length} tweets processed ===`);
    isProcessing = false;
    closePremiumPlusModal();
    return;
  }
  
  const tweetEl = tweets[index];
  console.log(`\n=== Processing tweet ${index + 1}/${tweets.length} ===`);
  const accountName = getAccountName(tweetEl);
  console.log('Account:', accountName);
  
  // プロモーションツイートの処理
  const isPromo = isPromoted(tweetEl);
  let shouldSkip = false;
  
  if (isPromo) {
    const text = tweetEl.innerText;
    console.log('Promoted tweet detected, checking conditions...');
    if (shouldDismiss(text)) {
      console.log('Conditions met, muting account...');
      muteAccount(tweetEl);
      processedTweets.add(tweetEl);
      shouldSkip = true;
      // ミュート処理は非同期なので、少し待ってから次へ
      setTimeout(() => {
        processNextTweet(tweets, index + 1);
      }, 2000);
      return;
    } else {
      console.log('Conditions not met, skipping...');
    }
  }
  
  // プロモーションツイートでない場合、またはプロモーションツイートでも条件を満たさない場合、フォロー/リツイート判定を実行
  if (!shouldSkip) {
    // リツイートかどうかを先に確認
    const isRT = isRetweet(tweetEl);
    console.log('Is retweet:', isRT);
    
    if (isRT) {
      // リツイートの場合：フォローしている人からのリツイートではない場合のみ「興味がない」に分類
      if (isNotRetweetFromFollowing(tweetEl)) {
        console.log('>>> ACTION: Dismissing retweet from non-following account');
        dismissAsNotInterested(tweetEl);
        processedTweets.add(tweetEl);
        // 非同期処理なので、少し待ってから次へ
        setTimeout(() => {
          processNextTweet(tweets, index + 1);
        }, 1500);
        return;
      } else {
        console.log('Retweet from following account, keeping it');
      }
    } else {
      // 通常のツイートの場合：フォローしていないアカウントによるツイートを「興味がない」に分類
      console.log('Checking if not following account...');
      if (isNotFollowingAccount(tweetEl)) {
        console.log('>>> ACTION: Dismissing tweet from non-following account');
        dismissAsNotInterested(tweetEl);
        processedTweets.add(tweetEl);
        // 非同期処理なので、少し待ってから次へ
        setTimeout(() => {
          processNextTweet(tweets, index + 1);
        }, 1500);
        return;
      } else {
        console.log('Tweet from following account, keeping it');
      }
    }
  }
  
  // 処理が不要な場合、すぐに次へ
  processedTweets.add(tweetEl);
  processNextTweet(tweets, index + 1);
}

// MutationObserverで動的追加にも対応
const observer = new MutationObserver(() => {
  // スクロールイベントの頻度を制限
  if (!scrollTimeout) {
    scrollTimeout = setTimeout(() => {
      console.log('DOM changed, scanning tweets...');
      scanTweets();
      scrollTimeout = null;
    }, 500);
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// スクロールイベントの監視を追加
window.addEventListener('scroll', () => {
  if (!scrollTimeout) {
    scrollTimeout = setTimeout(() => {
      console.log('Scroll detected, scanning tweets...');
      scanTweets();
      scrollTimeout = null;
    }, 500);
  }
});

// スクリプトが読み込まれたことを明確に示す
console.log('=== Twitter Ad Filter Extension Loaded ===');
console.log('Script is running on:', window.location.href);
console.log('Document ready state:', document.readyState);

// DOMが完全に読み込まれるまで待つ
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded, starting initial scan...');
    scanTweets();
  });
} else {
  console.log('DOM already loaded, starting initial scan...');
  scanTweets();
}
