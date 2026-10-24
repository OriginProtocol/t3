#### Instructions to start the server

###### Configure your environment

```
export SESSION_SECRET="Don't tell anyone."
export ENCRYPTION_SECRET="It's a secret"
export CLIENT_URL"=http://localhost:3000/#"
export DATABASE_URL="postgres://origin:origin@localhost/origin"

# Cloudflare Email Sending. MAIL_FROM_NAME is optional.
# Create an API token with the Email Sending: Edit permission.
export MAIL_FROM_EMAIL="support@shoporigin.com"
export MAIL_FROM_NAME="Origin Protocol"
export CLOUDFLARE_ACCOUNT_ID="<account id>"
export CLOUDFLARE_EMAIL_API_TOKEN="<token>"
```

Send a login email (real template, dummy link) before relying on a deploy:

```
node src/scripts/send_test_email.js you@example.com
```

There is no in-process mail fallback. Rolling back means redeploying the previous commit.

Setup 

Node.js 24.22.1 is pinned in `.nvmrc` and in `package.json` `engines`.

```
nvm install
yarn install
```

Run migration
```
yarn run migrate
```

##### Start the server
```
yarn run start
```

