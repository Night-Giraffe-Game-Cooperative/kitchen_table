defmodule Family.Mailer do
  @moduledoc """
  Sends the app's few emails (invitations and new one-time passwords).

  Every email is kept in the outbox, which admins can read in the app. That
  is all that happens on a computer with no email set up. With SMTP settings
  (see config/runtime.exs) it is also sent for real.
  """

  require Logger
  import Ecto.Query
  alias Family.Repo

  defmodule Email do
    use Ecto.Schema

    schema "outbox" do
      field :to, :string
      field :subject, :string
      field :body, :string
      timestamps(type: :utc_datetime, updated_at: false)
    end
  end

  def deliver(to, subject, body) do
    email = Repo.insert!(%Email{to: to, subject: subject, body: body})

    case Application.get_env(:family, :mailer, :outbox) do
      :smtp ->
        smtp = Application.fetch_env!(:family, :smtp)

        Task.start(fn ->
          case Family.Mailer.SMTP.send(smtp, to, subject, body) do
            :ok -> Logger.info("Sent \"#{subject}\" to #{to}")
            {:error, reason} -> Logger.error("Couldn't email #{to}: #{inspect(reason)}")
          end
        end)

      _ ->
        Logger.info("Email to #{to} kept in the outbox: #{subject}")
    end

    {:ok, email}
  end

  def outbox(limit \\ 50) do
    Email |> order_by(desc: :id) |> limit(^limit) |> Repo.all()
  end
end

defmodule Family.Mailer.SMTP do
  @moduledoc "A small SMTP client: STARTTLS on 587 or TLS on 465, then AUTH LOGIN."

  @timeout 15_000

  def send(opts, to, subject, body) do
    host = String.to_charlist(opts[:host])
    port = opts[:port]
    from = opts[:from]

    message = [
      "From: #{from}\r\n",
      "To: #{to}\r\n",
      "Subject: #{encode_subject(subject)}\r\n",
      "Date: #{Calendar.strftime(DateTime.utc_now(), "%a, %d %b %Y %H:%M:%S +0000")}\r\n",
      "Message-ID: <#{System.unique_integer([:positive])}.#{System.os_time()}@#{opts[:host]}>\r\n",
      "MIME-Version: 1.0\r\n",
      "Content-Type: text/plain; charset=utf-8\r\n",
      "Content-Transfer-Encoding: 8bit\r\n\r\n",
      body |> String.replace(~r/\r?\n/, "\r\n") |> String.replace("\r\n.", "\r\n.."),
      "\r\n.\r\n"
    ]

    with {:ok, conn} <- connect(host, port),
         {:ok, conn} <- expect(conn, 220),
         {:ok, conn} <- command(conn, "EHLO family.local", 250),
         {:ok, conn} <- maybe_starttls(conn, host, port),
         {:ok, conn} <- auth(conn, opts[:username], opts[:password]),
         {:ok, conn} <- command(conn, "MAIL FROM:<#{address(from)}>", 250),
         {:ok, conn} <- command(conn, "RCPT TO:<#{to}>", 250),
         {:ok, conn} <- command(conn, "DATA", 354),
         :ok <- write(conn, message),
         {:ok, conn} <- expect(conn, 250) do
      command(conn, "QUIT", 221)
      close(conn)
      :ok
    end
  end

  defp connect(host, 465) do
    with {:ok, sock} <- :ssl.connect(host, 465, ssl_opts(host), @timeout), do: {:ok, {:ssl, sock}}
  end

  defp connect(host, port) do
    with {:ok, sock} <- :gen_tcp.connect(host, port, [:binary, active: false], @timeout),
         do: {:ok, {:tcp, sock}}
  end

  defp maybe_starttls({:tcp, sock} = conn, host, _port) do
    with {:ok, _} <- command(conn, "STARTTLS", 220),
         {:ok, tls} <- :ssl.connect(sock, ssl_opts(host), @timeout),
         conn = {:ssl, tls},
         {:ok, conn} <- command(conn, "EHLO family.local", 250) do
      {:ok, conn}
    end
  end

  defp maybe_starttls(conn, _, _), do: {:ok, conn}

  defp ssl_opts(host) do
    [
      verify: :verify_peer,
      cacerts: :public_key.cacerts_get(),
      server_name_indication: host,
      customize_hostname_check: [match_fun: :public_key.pkix_verify_hostname_match_fun(:https)]
    ]
  end

  defp auth(conn, nil, _), do: {:ok, conn}

  defp auth(conn, user, pass) do
    with {:ok, conn} <- command(conn, "AUTH LOGIN", 334),
         {:ok, conn} <- command(conn, Base.encode64(user), 334) do
      command(conn, Base.encode64(pass), 235)
    end
  end

  defp command(conn, line, code) do
    with :ok <- write(conn, [line, "\r\n"]), do: expect(conn, code)
  end

  defp expect(conn, code) do
    case read_reply(conn, "") do
      {:ok, <<got::binary-size(3), _::binary>> = reply} ->
        if got == Integer.to_string(code), do: {:ok, conn}, else: {:error, String.trim(reply)}

      error ->
        error
    end
  end

  # Multi-line replies end with a line whose fourth character is a space.
  defp read_reply(conn, acc) do
    with {:ok, data} <- recv(conn) do
      acc = acc <> data
      lines = String.split(acc, "\r\n", trim: true)

      if String.ends_with?(acc, "\r\n") and match?(<<_::binary-size(3), " ", _::binary>>, List.last(lines) || ""),
        do: {:ok, List.last(lines)},
        else: read_reply(conn, acc)
    end
  end

  defp write({:tcp, s}, data), do: :gen_tcp.send(s, data)
  defp write({:ssl, s}, data), do: :ssl.send(s, data)
  defp recv({:tcp, s}), do: :gen_tcp.recv(s, 0, @timeout)
  defp recv({:ssl, s}), do: :ssl.recv(s, 0, @timeout)
  defp close({:tcp, s}), do: :gen_tcp.close(s)
  defp close({:ssl, s}), do: :ssl.close(s)

  defp address(from) do
    case Regex.run(~r/<([^>]+)>/, from) do
      [_, addr] -> addr
      _ -> from
    end
  end

  defp encode_subject(subject) do
    if subject =~ ~r/^[\x20-\x7E]*$/, do: subject, else: "=?UTF-8?B?#{Base.encode64(subject)}?="
  end
end
