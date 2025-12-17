// スクロールタイムアウトの管理用変数
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

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
  // 「フォロー」ボタンがあるかどうかで判定
  const followButton = tweetElement.querySelector('[data-testid="follow"], [aria-label*="フォロー"], [aria-label*="Follow"]');
  const isNotFollowing = followButton !== null;
  console.log('Is not following account:', isNotFollowing);
  return isNotFollowing;
}

// フォローしている人からのリツイートではないかどうかを判定
function isNotRetweetFromFollowing(tweetElement: HTMLElement): boolean {
  // リツイートの表示を探す
  const retweetIndicator = tweetElement.querySelector('[data-testid="socialContext"], [data-testid="retweet"]');
  
  if (!retweetIndicator) {
    // リツイートではない場合は、フォローしていないアカウントからのツイートとして扱う
    return isNotFollowingAccount(tweetElement);
  }
  
  // リツイートの場合、フォローしている人からのリツイートかどうかを判定
  // リツイート要素内に「フォロー」ボタンがない場合は、フォローしている人からのリツイート
  const followButtonInRetweet = retweetIndicator.closest('article')?.querySelector('[data-testid="follow"]');
  const isFromFollowing = followButtonInRetweet === null;
  console.log('Is not retweet from following:', !isFromFollowing);
  return !isFromFollowing;
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
  console.log('Scanning tweets...');
  const tweetArticles = document.querySelectorAll('article');
  console.log(`Found ${tweetArticles.length} tweets`);
  
  // 処理済みのツイートを記録
  const processedTweets = new Set<HTMLElement>();
  
  tweetArticles.forEach((article, index) => {
    const tweetEl = article as HTMLElement;
    
    // すでに処理済みのツイートはスキップ
    if (processedTweets.has(tweetEl)) {
      return;
    }
    
    // ビューポート内のツイートのみを処理
    if (isInViewport(tweetEl)) {
      console.log(`\nAnalyzing tweet ${index + 1} in viewport:`);
      
      // プロモーションツイートの処理
      if (isPromoted(tweetEl)) {
        const text = tweetEl.innerText;
        console.log('Checking promotion conditions for:', text);
        if (shouldDismiss(text)) {
          console.log('Conditions met, muting account...');
          muteAccount(tweetEl);
          // 処理済みとしてマーク
          processedTweets.add(tweetEl);
        } else {
          console.log('Conditions not met, skipping...');
        }
      }
      
      // フォローしていないアカウントによるツイートを「興味がない」に分類
      if (isNotFollowingAccount(tweetEl)) {
        console.log('Not following account, dismissing as not interested...');
        dismissAsNotInterested(tweetEl);
        processedTweets.add(tweetEl);
      }
      
      // フォローしている人からのリツイートではないツイートを「興味がない」に分類
      if (isNotRetweetFromFollowing(tweetEl)) {
        console.log('Not retweet from following, dismissing as not interested...');
        dismissAsNotInterested(tweetEl);
        processedTweets.add(tweetEl);
      }
    }
  });
  closePremiumPlusModal();
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

// 初回スキャンも
console.log('Initial scan starting...');
scanTweets();
