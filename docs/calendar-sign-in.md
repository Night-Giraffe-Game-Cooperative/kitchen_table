# Linking Google and Outlook calendars both ways

Kitchen Table can show a Google or Outlook calendar from its secret address
without any setting up, but only to look at. To add to it and change it from
Kitchen Table too, people sign in to Google or Microsoft from **Linked
calendars**. For that, Kitchen Table has to be registered with Google and
with Microsoft, as an app of yours. It's free, it's done once for the whole
family, and it takes ten minutes or so for each.

You need the address your family uses for Kitchen Table, such as
`https://kitchen.example.org`. The two addresses to give Google and
Microsoft are that address with `/calendar-connect/google` or
`/calendar-connect/microsoft` on the end. An admin sees them, ready to copy,
in **Calendar**, **Month**, **Linked calendars**, then Google or Outlook.

Signing in works best in a phone's or computer's own browser. The Android
app for kids' tablets can't do it, as Google doesn't allow signing in inside
other apps. If Kitchen Table opens signed out when you come back from Google
or Microsoft, link the calendar from the browser instead. Once it's linked,
every device shows it.

## Google

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and
   sign in with any Google account. Make a new project and call it Kitchen
   Table.
2. Under **APIs and services**, **Library**, find **Google Calendar API** and
   turn it on.
3. Open **Google Auth Platform** and choose **Get started**. Name the app
   Kitchen Table, give your email, choose **External**, and finish.
4. Under **Data access**, add these scopes: `openid`, `email`,
   `.../auth/calendar.events` and `.../auth/calendar.calendarlist.readonly`.
   Kitchen Table sees and changes events, and lists the calendars to choose
   from; it can't share calendars or delete them.
5. Under **Audience**, choose **Publish app**. Until it's published, Google
   signs people out of it after seven days. Google won't check the app unless
   you ask it to, which a family doesn't need: up to 100 people can use an
   unchecked app, and Google shows them a warning first. They choose
   **Advanced**, then **Go to Kitchen Table**.
6. Under **Clients**, choose **Create client**, then **Web application**. Add
   the Google address from above under **Authorized redirect URIs**, and
   create it.
7. Copy the **Client ID** and **Client secret** straight away (Google may not
   show the secret again) and paste them into Kitchen Table.

## Microsoft (Outlook.com, Hotmail and Microsoft 365)

1. Go to [entra.microsoft.com](https://entra.microsoft.com/) and sign in. If
   it says your account isn't part of a directory, Microsoft no longer lets
   personal accounts register apps on their own: signing up for a free Azure
   account at [azure.microsoft.com/free](https://azure.microsoft.com/free)
   makes one. It may ask for a card to check who you are; registering an app
   costs nothing.
2. Under **App registrations**, choose **New registration**. Name it Kitchen
   Table. For who can use it, choose **Accounts in any organizational
   directory and personal Microsoft accounts**. Under **Redirect URI**, choose
   **Web** and put in the Microsoft address from above. Register it.
3. Copy the **Application (client) ID** from its overview.
4. Under **API permissions**, choose **Add a permission**, **Microsoft
   Graph**, **Delegated permissions**, and add `Calendars.ReadWrite`, plus
   `openid`, `email` and `offline_access`.
5. Under **Certificates and secrets**, make a **New client secret**. Copy its
   **Value** (not its ID) straight away and paste it into Kitchen Table with
   the client ID. A secret lasts up to two years: make a new one and paste it
   in before then, or calendars linked through Microsoft stop updating.

## Running your own server

Instead of pasting them into the app, whoever runs the server can set
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, or `MICROSOFT_CLIENT_ID` and
`MICROSOFT_CLIENT_SECRET`. These win over anything pasted in, and admins
can't change them from the app. `MICROSOFT_TENANT` keeps Microsoft sign-ins
to one organisation's work or school accounts.

Secrets pasted in are sealed with a key made from the server's secret, like
calendar passwords, and so are the sign-ins people make. Nothing goes to
Google or Microsoft except to sign in and to read and write the calendars
people chose.
