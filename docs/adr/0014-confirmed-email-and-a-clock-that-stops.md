# 14. Confirmed email, password resets, and a clock that stops

## Context

Anyone could register with any address and play at once, and a forgotten password was the end of an account. Players also finished a mission and watched the session clock keep spending their play time, because the only way to stop it was a button on the System screen.

## Decision

- **Registering issues no tokens.** A six-digit code goes to the email, and the account can't be used until that code comes back. Logging in with the right password before that says so, and only after the right password, so it tells a stranger nothing.
- **A password can be reset by a code** sent to a confirmed email. The request takes a username or an email. An email isn't unique, so each message names its username, which also rescues someone who forgot theirs.
- **Registering and resetting ask for the password twice,** in the browser and on the server, and every password field can be shown and hidden.
- **Limits make six digits safe:** five guesses per code, 10 minutes for a reset and 30 for confirming, a minute between codes, five an hour and ten a day. Only a keyed hash of a code is stored. A reset ends every session on every device at once, including access tokens.
- **Nothing reveals an account or an email.** Requests get the same answer whether or not anything matched, and the sending happens outside the request so the timing doesn't differ either.
- **Unconfirmed accounts are deleted after 48 hours,** so a username can't be held with an address nobody owns. Accounts that existed before this change count as confirmed.
- **Finishing a mission stops the clock** and returns the unused time to the bank. The next mission asks for a new session, one click away. A Stop button sits next to the timer in the top bar. Solving a mission keeps the clock running, because its questions still need the session.

## Consequences

Sending mail needs an SMTP account in production. If SMTP is down, nobody can finish registering, though the answer to each request stays the same and they can ask again. A player clearing several missions in a row clicks Open session each time, in return for never losing time they didn't mean to spend.
