/**
 * Default settings for BetterUnsubscribe
 */
const DEFAULT_SETTINGS = {
  autoSendEmail: false, // Don't automatically send emails by default
  confirmRules: [], // No confirmation rules by default
};

/**
 * Logs messages to the console with a custom prefix for better identification.
 * Used for debug and informational messages related to BetterUnsubscribe's popup.js.
 * @param {...any} args - The arguments to log to the console.
 */
function console_log(...args) {
  console.log('[BetterUnsubscribe][popup.js]', ...args);
}

/**
 * Logs error messages to the console with a custom prefix.
 * This is useful for clear and specific error reporting during development and debugging.
 * @param {...any} args - The error arguments to log to the console.
 */
function console_error(...args) {
  console.error('[BetterUnsubscribe][popup.js]', ...args);
}



/**
 * Main event listener for the DOMContentLoaded event.
 * Responsible for retrieving the active tab and displayed message,
 * setting up button event listeners, and managing the unsubscribe logic.
 */
document.addEventListener('DOMContentLoaded', async () => {
  // Retrieve and cache references to various DOM elements for later use.
  const nameAddress = document.getElementById('nameAddress');
  const unsubscribeButton = document.getElementById('unsubscribeButton');
  const cancelButton = document.getElementById('cancelButton');
  const statusText = document.getElementById('statusText');
  const detailsText = document.getElementById('detailsText');
  const detailsCode = document.getElementById('dynamicCodeBlock');
  const detailsCodeContainer = document.getElementById('dynamicCodeContainer');



  const settings = await messenger.storage.local.get(DEFAULT_SETTINGS);
  console_log('Loaded settings:', settings);

  // Retrieve the currently active tab in the current window and get displayed message details.
  const [tab] = await messenger.tabs.query({
    active: true,
    currentWindow: true,
  });
  const message = await messenger.messageDisplay.getDisplayedMessage(tab.id);
  console_log('Message', message.id);

  // Retrieve the message's author and parse it to extract name, sender, and domain information.
  const author = message.author;
  console_log(author);

  let name = undefined;
  let sender = undefined;
  let domain = undefined;

  // Populated once the getMethod response arrives; used for confirmation rule matching.
  let unsubAddress = null;

  // Use parseMailboxString (available since TB 137) to parse the author field.
  // https://webextension-api.thunderbird.net/en/latest/messengerUtilities.html
  if (messenger.messengerUtilities?.parseMailboxString) {
    try {
      const parsed =
        await messenger.messengerUtilities.parseMailboxString(author);
      if (parsed?.length > 0) {
        const { name: parsedName, email } = parsed[0];
        name = parsedName || '';
        if (email) {
          const atIndex = email.lastIndexOf('@');
          if (atIndex !== -1) {
            sender = email.substring(0, atIndex);
            domain = email.substring(atIndex + 1);
          }
        }
        console_log(`Name: ${name}, Sender: ${sender}, Domain: ${domain}`);
      }
    } catch (e) {
      console_error('parseMailboxString failed, falling back to regex', e);
    }
  }

  // Fallback: regex parsing for compatibility with TB < 137.
  if (sender === undefined) {
    const addressRegex = new RegExp(
      '^("?([^"\\n]*)"?[\\t ]+)?<?("[^"\\n]*"|[^@\\s]+)@(\\S+\\.[a-zA-Z]{2,})>?$'
    );
    const match = author.match(addressRegex);
    if (match) {
      name = match[2] || ''; // Optional name fallback if not present.
      sender = match[3];
      domain = match[4];
      console_log(`Name: ${name}, Sender: ${sender}, Domain: ${domain}`);
    } else {
      console_error(`Invalid email format: ${author}`);
    }
  }

  // Display the author's email in the UI.
  nameAddress.textContent = author;



  // Request the unsubscribe method details from the background script.
  messenger.runtime
    .sendMessage({ messageId: message.id, getMethod: true })
    .then((r) => {
      console_log('Received', r);
      unsubAddress = r.address || null;

      // Update the UI based on the received unsubscribe method (Post, Email, or Browser).
      switch (r.method) {
        case 'Post':
          detailsText.textContent =
            messenger.i18n.getMessage('detailsTextPost');
          detailsCode.textContent = r.address;
          detailsCodeContainer.hidden = false;
          break;
        case 'Email':
          detailsText.textContent =
            messenger.i18n.getMessage('detailsTextEmail');
          detailsCode.textContent = r.address;
          detailsCodeContainer.hidden = false;
          break;
        case 'Browser':
          detailsText.textContent = messenger.i18n.getMessage('detailsTextWeb');
          detailsCode.textContent = r.address;
          detailsCodeContainer.hidden = false;
          break;
        case 'None':
          detailsText.textContent =
            messenger.i18n.getMessage('detailsTextNone');
          break;
        default:
        // No action required if no method is provided.
      }
    })
    .catch((error) => {
      console_error('Error receiving methodInfo from background:', error);
    });

  /**
   * Sends the unsubscribe request to the background script and updates UI status.
   */
  async function doUnsubscribe() {
    unsubscribeButton.disabled = true;
    statusText.removeAttribute('hidden');
    statusText.textContent = messenger.i18n.getMessage('statusTextWorking');

    messenger.runtime
      .sendMessage({ messageId: message.id, unsubscribe: true })
      .then((r) => {
        console_log('Response from background:', r);
        if (r.response === 'Unsubscribed') {
          statusText.textContent = messenger.i18n.getMessage('statusTextDone');
        } else if (r.response === 'Failed') {
          unsubscribeButton.disabled = false;
          statusText.textContent =
            messenger.i18n.getMessage('statusTextError') +
            (r.error ? ': ' + r.error : '');
          statusText.title = r.error; // Full error on hover
        }
      })
      .catch((error) => {
        console_error('Error sending unsubscribe message:', error);
        statusText.textContent = messenger.i18n.getMessage('statusTextError');
      });
  }

  /**
   * Event listener for the "Unsubscribe" button.
   * Checks confirmation rules first; if a rule matches, shows the confirmation
   * section instead of unsubscribing immediately.
   */
  unsubscribeButton.addEventListener('click', async () => {
    const rules = Array.isArray(settings.confirmRules)
      ? settings.confirmRules
      : [];
    const matchedRule = findMatchingRule(rules, author, unsubAddress);

    if (matchedRule) {
      document.getElementById('confirmWarning').textContent =
        matchedRule.description ||
        messenger.i18n.getMessage('confirmUnsubscribeWarning');
      document.getElementById('confirmAuthor').textContent = author;
      document.getElementById('confirmTarget').textContent = unsubAddress;
      document.getElementById('unsubSection').hidden = true;
      document.getElementById('confirmSection').hidden = false;
      return;
    }

    await doUnsubscribe();
  });

  /**
   * Event listener for the "Yes, Unsubscribe" button in the confirmation section.
   */
  document
    .getElementById('confirmYesButton')
    .addEventListener('click', async () => {
      document.getElementById('confirmSection').hidden = true;
      document.getElementById('unsubSection').hidden = false;
      await doUnsubscribe();
    });

  /**
   * Event listener for the "Cancel" button in the confirmation section.
   * Returns to the main unsubscribe view without taking action.
   */
  document.getElementById('confirmNoButton').addEventListener('click', () => {
    document.getElementById('confirmSection').hidden = true;
    document.getElementById('unsubSection').hidden = false;
  });

  /**
   * Event listener for the "Cancel" button.
   * Sends a cancel request to the background script and closes the popup window upon completion.
   */
  cancelButton.addEventListener('click', async () => {
    try {
      const r = await messenger.runtime.sendMessage({
        messageId: message.id,
        cancel: true,
      });
      console_log('Response from background:', r);
      window.close();
    } catch (error) {
      console_error('Error sending cancel message:', error);
    }
  });


});

/**
 * Finds the first confirmation rule whose regex matches the sender or unsubscribe address.
 * @param {{regex: string, description: string}[]} rules
 * @param {string} author - Sender string from the message header.
 * @param {string|null} address - Unsubscribe URL or email address, if known.
 * @returns {{regex: string, description: string}|null}
 */
function findMatchingRule(rules, author, address) {
  for (const rule of rules) {
    if (!rule.regex) continue;
    try {
      const re = new RegExp(rule.regex, 'i');
      if ((author && re.test(author)) || (address && re.test(address))) {
        return rule;
      }
    } catch (e) {
      // Skip rules with invalid regex
    }
  }
  return null;
}


