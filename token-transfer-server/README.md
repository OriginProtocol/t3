#### Instructions to start the server

###### Configure your environment

```
export SESSION_SECRET="Don't tell anyone."
export ENCRYPTION_SECRET="It's a secret"
export CLIENT_URL"=http://localhost:3000/#"
export DATABASE_URL="postgres://origin:origin@localhost/origin"

# Outbound email. MAIL_PROVIDER is "cloudflare" or "sendgrid".
# Unset defaults to sendgrid. There is no automatic failover.
export MAIL_PROVIDER="cloudflare"
export MAIL_FROM_EMAIL="support@shoporigin.com"
export MAIL_FROM_NAME="Origin Protocol"
# Cloudflare Email Sending (required when MAIL_PROVIDER=cloudflare).
# Create an API token with the Email Sending: Edit permission.
export CLOUDFLARE_ACCOUNT_ID="<account id>"
export CLOUDFLARE_EMAIL_API_TOKEN="<token>"
# SendGrid (required when MAIL_PROVIDER=sendgrid).
# SENDGRID_FROM_EMAIL is also used as the from address when MAIL_FROM_EMAIL is unset.
export SENDGRID_FROM_EMAIL="Origin Protocol <support@shoporigin.com>"
export SENDGRID_API_KEY="<SendGrid key>"
```

Send a login email (real template, dummy link) through the configured provider before flipping production:

```
node src/scripts/send_test_email.js you@example.com
```

To roll back to SendGrid, set `MAIL_PROVIDER=sendgrid` and restart. Leave the Cloudflare variables in place; they are only read when Cloudflare is selected. Do not point both providers at the same traffic: the server sends with exactly one provider.

Setup 

```
nvm install 10.15.3
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

