(() => {
  const main = document.querySelector('.site-main');
  if (!(main instanceof HTMLElement)) {
    return;
  }

  const copyTextToClipboard = (value) => {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(value);
    }

    return new Promise((resolve, reject) => {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      try {
        if (!document.execCommand('copy')) {
          throw new Error('Copy command was rejected.');
        }
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        textarea.remove();
      }
    });
  };

  const isEligibleBlock = (node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    return node.matches('pre, .highlighter-rouge');
  };

  const createCopyButton = (wrapper, text) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ts-doc-code-block__button';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy code snippet');
    button.setAttribute('title', 'Copy code snippet');

    let resetTimer = null;
    const resetLabel = () => {
      button.textContent = 'Copy';
      button.classList.remove('is-copied');
      resetTimer = null;
    };

    button.addEventListener('click', () => {
      copyTextToClipboard(text)
        .then(() => {
          button.textContent = 'Copied';
          button.classList.add('is-copied');
          if (resetTimer !== null) {
            window.clearTimeout(resetTimer);
          }
          resetTimer = window.setTimeout(resetLabel, 1600);
        })
        .catch(() => {
          button.textContent = 'Copy failed';
          button.classList.remove('is-copied');
          if (resetTimer !== null) {
            window.clearTimeout(resetTimer);
          }
          resetTimer = window.setTimeout(resetLabel, 1800);
        });
    });

    wrapper.appendChild(button);
  };

  Array.from(main.children).forEach((block) => {
    if (!isEligibleBlock(block) || block.closest('.ts-doc-code-block')) {
      return;
    }

    const codeNode = block.matches('pre')
      ? block.querySelector('code')
      : block.querySelector('pre code');

    const text = codeNode instanceof HTMLElement ? codeNode.textContent : block.textContent;
    if (!text || !text.trim()) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'ts-doc-code-block';

    block.parentNode.insertBefore(wrapper, block);
    wrapper.appendChild(block);
    createCopyButton(wrapper, text.replace(/\n$/, ''));
  });
})();
