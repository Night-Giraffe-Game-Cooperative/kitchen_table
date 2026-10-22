defmodule FamilyWeb.Privacy do
  @moduledoc """
  The privacy page at /privacy. Google asks for one before an app that signs
  people in to Google can be published, and it's worth having anyway: what
  the app keeps, where, and what it does with calendars people link.
  """

  @updated "22 October 2026"

  def page do
    app = Application.get_env(:family, :app_name, "Kitchen Table") |> Plug.HTML.html_escape()

    """
    <!doctype html>
    <html lang="en-GB">
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Privacy · #{app}</title>
    <style>
      body { margin: 0; padding: 1.5rem 1rem 3rem; font: 1.05rem/1.6 system-ui, sans-serif; background: #fbf7f0; color: #2b2520; }
      main { max-width: 40rem; margin: 0 auto; }
      h1 { font-size: 1.8rem; margin: 0 0 .25rem; }
      h2 { font-size: 1.2rem; margin: 2rem 0 .25rem; }
      ul { padding-left: 1.25rem; }
      li { margin: .25rem 0; }
      .muted { color: #6b6158; }
      a { color: #3b5bdb; }
      @media (prefers-color-scheme: dark) { body { background: #1d1a17; color: #f1ebe3; } .muted { color: #b5aa9e; } a { color: #9db0ff; } }
    </style>
    </head>
    <body>
    <main>
      <h1>Privacy</h1>
      <p class="muted">#{app}. Last changed #{@updated}.</p>

      <p>#{app} is a family's own app for messages, games, tasks and a shared calendar. This copy is run by a family for themselves. It shows no adverts, sells nothing, and nobody outside the family can see into it.</p>

      <h2>What it keeps</h2>
      <ul>
        <li>Each person's name and email address, their password (scrambled, so it can't be read back), and the settings a family admin chose for them.</li>
        <li>What the family puts in: messages, photos, doodles, games, tasks, homework, rewards and calendar events.</li>
        <li>For notifications, the address each phone or browser gives the app to send them to.</li>
        <li>One cookie, to keep you signed in. There's no tracking and no analytics.</li>
      </ul>
      <p>It's all kept on the family's own server. Backups of it are kept for up to two weeks.</p>

      <h2>Calls</h2>
      <p>Video and sound go straight between the devices in a call, or through the family's own relay server when they can't reach each other. Calls aren't recorded. A picture someone saves from a call to a chat is kept like any other photo.</p>

      <h2>Google and Outlook calendars</h2>
      <p>If you link a Google or Outlook calendar by signing in, #{app} can:</p>
      <ul>
        <li>see the list of your calendars, so you can choose which to link;</li>
        <li>see, add, change and delete events in the calendars you choose.</li>
      </ul>
      <p>It uses this only to show those events in the family calendar, to the people in the family you choose, and to copy events added or changed in #{app} back to your calendar. It doesn't look at your other calendars, your email or anything else in your account.</p>
      <p>It keeps a copy of the events from the calendars you chose, and your sign-in, sealed so it can't be read from the database alone. Calendars linked with an address and password, such as iCloud, work the same way, and the password is sealed too. Unlinking a calendar deletes its copy; once your last calendar from an account is unlinked, the sign-in is deleted too, and Google is asked to cancel it.</p>
      <p>#{app}'s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. Nothing from your calendars is sold, shared with anyone outside your family, used for adverts, or used to train AI.</p>

      <h2>Seeing and deleting what's yours</h2>
      <p>Under Me, anyone can download a zip of everything the app keeps about them, and grown-ups can delete their account. A family admin can download the whole family's. Deleting an account removes that person's messages, photos, doodles, linked calendars and sign-ins. Things the family shares, such as events and games, stay without their name on them.</p>

      <h2>Children</h2>
      <p>Children's accounts are made by a grown-up in the family, and children can only chat with people their guardians allow. To delete a child's account, ask their guardian.</p>

      <h2>Questions</h2>
      <p>Ask whoever set up #{app} in your family.</p>

      <p><a href="/">Back to #{app}</a></p>
    </main>
    </body>
    </html>
    """
  end
end
