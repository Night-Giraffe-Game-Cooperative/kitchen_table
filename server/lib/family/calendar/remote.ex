defmodule Family.Calendar.Remote do
  @moduledoc """
  What the Google and Microsoft calendar APIs share: JSON requests with an
  access token, following pages, and turning their events into the rows
  Family.Calendar.Links keeps.
  """

  require Logger
  alias Family.HTTP

  @max_body 20_000_000
  # Enough for a busy family calendar over a year and a bit; a calendar with
  # more is cut off rather than slowing everything else down.
  @max_pages 20

  @doc """
  Sends a request and reads the JSON that comes back: `{:ok, status, json,
  reply}`. A 401 is `{:error, :unauthorized}`; a 403 is `:read_only`, as
  that's what it means once someone is signed in.
  """
  def request(method, url, token, body \\ nil, headers \\ []) do
    headers =
      [{"authorization", "Bearer " <> token}, {"accept", "application/json"}, {"user-agent", "KitchenTable/1.0 (family calendar)"} | headers] ++
        if(body, do: [{"content-type", "application/json"}], else: [])

    payload = if body, do: Jason.encode!(body), else: nil

    case HTTP.request(method, URI.parse(url), headers, payload,
           max_body: @max_body,
           timeout: 30_000,
           allow_private: Application.get_env(:family, :calendar_private_hosts, false)
         ) do
      {:ok, %{status: 401}} ->
        {:error, :unauthorized}

      {:ok, %{status: 403} = resp} ->
        Logger.info("Calendar API #{URI.parse(url).host}: HTTP 403 #{String.slice(resp.body, 0, 200)}")
        # Google says it's had too many requests with a 403 too: that passes.
        if resp.body =~ ~r/rateLimitExceeded|quotaExceeded|usageLimits/, do: {:error, {:http, 429}}, else: {:error, :read_only}

      {:ok, %{status: status, body: text} = resp} ->
        json =
          case text do
            "" -> %{}
            _ -> with({:ok, %{} = map} <- Jason.decode(text), do: map, else: (_ -> %{}))
          end

        {:ok, status, json, resp}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Every item over a list's pages. `next` gives the address of the page after
  a reply, or nil when that was the last.
  """
  def pages(first_url, token, items_key, next, headers \\ []) do
    Enum.reduce_while(1..@max_pages, {first_url, []}, fn _, {url, acc} ->
      case request("GET", url, token, nil, headers) do
        {:ok, 200, json, _} ->
          acc = acc ++ List.wrap(json[items_key])

          case next.(json) do
            nil -> {:halt, {:ok, acc}}
            more -> {:cont, {more, acc}}
          end

        {:ok, status, _, _} ->
          {:halt, status_error(status)}

        {:error, _} = error ->
          {:halt, error}
      end
    end)
    |> case do
      {:ok, items} -> {:ok, items}
      {:error, _} = error -> error
      # Ran out of pages: what came so far.
      {_url, items} -> {:ok, items}
    end
  end

  def status_error(status) when status in [404, 410], do: {:error, :gone}
  def status_error(412), do: {:error, :changed}
  def status_error(status), do: {:error, {:http, status}}

  @doc "Part of an address, with anything that isn't a plain letter or number escaped."
  def segment(id), do: URI.encode(id, &URI.char_unreserved?/1)

  @doc "The people an event is for, as kept in a calendar: \"3,7\"."
  def who(text) when is_binary(text) do
    text
    |> String.split(",", trim: true)
    |> Enum.flat_map(fn s ->
      case Integer.parse(String.trim(s)) do
        {n, ""} -> [n]
        _ -> []
      end
    end)
  end

  def who(_), do: []

  @doc """
  An event's notes as plain text. Google keeps them as a little HTML when
  they're written in its calendar, so line breaks and links come through
  and the tags don't.
  """
  def text(nil), do: nil

  def text(notes) when is_binary(notes) do
    notes =
      if notes =~ ~r/<(br|p|div|a|b|i|u|ul|ol|li|span)\b/i do
        notes
        |> String.replace(~r/<br\s*\/?>|<\/p>|<\/div>|<\/li>/i, "\n")
        |> String.replace(~r/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/is, fn whole ->
          case Regex.run(~r/href="([^"]*)"[^>]*>(.*?)<\/a>/is, whole) do
            [_, href, label] -> if String.trim(label) in [href, ""], do: href, else: "#{label} (#{href})"
            _ -> whole
          end
        end)
        |> String.replace(~r/<[^>]+>/, "")
        |> unescape()
      else
        notes
      end

    notes |> String.replace("\r\n", "\n") |> String.trim() |> blank() |> slice(4000)
  end

  defp unescape(text) do
    text
    |> String.replace("&nbsp;", " ")
    |> String.replace("&lt;", "<")
    |> String.replace("&gt;", ">")
    |> String.replace("&quot;", "\"")
    |> String.replace("&#39;", "'")
    |> String.replace("&amp;", "&")
  end

  def blank(nil), do: nil
  def blank(s), do: if(String.trim(s) == "", do: nil, else: s)

  def slice(nil, _), do: nil
  def slice(s, n), do: String.slice(s, 0, n)

  @doc "A title, or something to show when an event hasn't one."
  def title(nil), do: "(No title)"
  def title(s), do: s |> String.trim() |> blank() |> Kernel.||("(No title)") |> String.slice(0, 255)
end
