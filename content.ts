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
  const isNotFollowing = followButton !== null;
  
  console.log('Checking if not following account:', {
    hasFollowButton: isNotFollowing,
    hasFollowingButton: followingButton !== null,
    accountName: getAccountName(tweetElement),
    tweetText: tweetElement.innerText.substring(0, 100)
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

// リツイートの元のツイート主のアカウント名を取得
function getOriginalTweetAuthor(tweetElement: HTMLElement): string | null {
  // リツイートの場合、元のツイート主の情報を探す
  // リツイートの構造では、通常は複数のアカウントリンクがある
  // 最初のリンクはリツイートした人、2番目以降が元のツイート主の可能性がある
  
  const allLinks = Array.from(tweetElement.querySelectorAll('a[role="link"][href^="/"]'));
  console.log('Found links in retweet:', allLinks.map(link => link.getAttribute('href')));
  
  // リツイートの場合、元のツイート主のリンクを探す
  // 通常、リツイートの構造では、元のツイート主の情報が特定の位置にある
  // より確実な方法として、ツイートのテキストからアカウント名を抽出する
  const textContent = tweetElement.innerText || '';
  
  // リツイートの場合、元のツイート主のアカウント名が表示されている
  // 例: "ユーザー名 @accountname · 時間" のような形式
  const accountMatch = textContent.match(/@(\w+)/);
  if (accountMatch && accountMatch.length > 1) {
    // 最初の@マークの後のアカウント名を取得（リツイートした人ではなく、元のツイート主）
    // リツイートの構造を考慮して、適切なアカウント名を取得
    const accountName = accountMatch[1];
    console.log('Found original tweet author:', accountName);
    return accountName;
  }
  
  // リンクから取得を試みる
  if (allLinks.length > 1) {
    // 2番目のリンクが元のツイート主の可能性が高い
    const originalAuthorLink = allLinks[1];
    const href = originalAuthorLink.getAttribute('href');
    if (href) {
      const accountName = href.substring(1).split('/')[0];
      console.log('Found original tweet author from link:', accountName);
      return accountName;
    }
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
  
  // 元のツイート主の部分を特定するために、より詳細に探す
  // リツイートの場合、元のツイート主の情報は通常、ツイートの下部に表示される
  
  // まず「フォロー中」ボタンを探す（フォローしている場合）
  // リツイート全体から探すが、元のツイート主に関連する部分を優先
  let followingButton = tweetElement.querySelector('[data-testid*="unfollow"], [aria-label*="フォロー中"], [aria-label*="Following"]');
  
  if (!followingButton) {
    // より広範囲に探す
    const buttons = Array.from(tweetElement.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]'));
    followingButton = buttons.find(btn => {
      const label = btn.getAttribute('aria-label') || '';
      const text = btn.textContent || '';
      return /フォロー中|Following/i.test(label) || /フォロー中|Following/i.test(text);
    }) as HTMLElement | null;
  }
  
  if (followingButton) {
    console.log('Retweet from following account (found Following button)');
    return false; // フォローしている人からのリツイート
  }
  
  // 次に「フォロー」ボタンを探す（フォローしていない場合）
  let followButton = tweetElement.querySelector('[data-testid="follow"]');
  
  if (!followButton) {
    // より広範囲にボタンを探す
    const buttons = Array.from(tweetElement.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]'));
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
  
  // ボタンが見つからない場合、デフォルトで「フォローしていない」と判定
  // （リツイートの場合、フォローしていないアカウントからのリツイートが多いため）
  const isNotFromFollowing = followButton !== null;
  
  // ボタンが見つからない場合は、より積極的に「フォローしていない」と判定
  // ただし、リツイートした人がフォローしている場合は例外
  const defaultToNotFollowing = followButton === null && followingButton === null;
  
  console.log('Checking if not retweet from following:', {
    isRetweet: true,
    hasFollowButton: isNotFromFollowing,
    hasFollowingButton: followingButton !== null,
    originalAuthor: originalAuthor,
    defaultToNotFollowing: defaultToNotFollowing,
    isNotFromFollowing: isNotFromFollowing || defaultToNotFollowing
  });
  
  return isNotFromFollowing || defaultToNotFollowing;
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

// document.bodyが存在する場合のみobserverを設定
if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
  console.log('MutationObserver initialized');
} else {
  console.log('document.body not found, waiting...');
  // document.bodyが存在しない場合、DOMContentLoadedを待つ
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
        console.log('MutationObserver initialized after DOMContentLoaded');
      }
    });
  }
}

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
try {
  console.log('=== Twitter Ad Filter Extension Loaded ===');
  console.log('Script is running on:', window.location.href);
  console.log('Document ready state:', document.readyState);
  console.log('Document body exists:', document.body !== null);
  
  // DOMが完全に読み込まれるまで待つ
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('DOM Content Loaded, starting initial scan...');
      setTimeout(() => scanTweets(), 1000);
    });
  } else {
    console.log('DOM already loaded, starting initial scan...');
    // DOMが完全に読み込まれるまで少し待つ
    setTimeout(() => scanTweets(), 1000);
  }
} catch (error) {
  console.error('Error initializing extension:', error);
}
