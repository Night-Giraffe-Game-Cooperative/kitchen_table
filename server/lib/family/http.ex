defmodule Family.HTTP do
  @moduledoc """
  Plain HTTP/1.1 requests over Mint, for the few times the server reaches
  out to another one: linked calendars, and phone notifications through the
  browsers' push services.
  """

  @doc """
  Sends one request and reads the whole reply. Gives `{:ok, %{status,
  headers, body}}`, or `{:error, reason}` where reason is `:too_big`,
  `:private`, `:no_host` or whatever Mint said.

  The host's name is looked up once, every address it gives is checked, and
  the connection goes to an address that was checked, so a name can't point
  somewhere public for the check and somewhere private for the request.
  Private addresses (the server's own network, or the machine itself) are
  refused unless `allow_private: true`.
  """
  def request(method, %URI{} = uri, headers, body, opts \\ []) do
    max_body = Keyword.get(opts, :max_body, 1_000_000)
    deadline = System.monotonic_time(:millisecond) + Keyword.get(opts, :timeout, 30_000)
    scheme = if uri.scheme == "https", do: :https, else: :http
    port = uri.port || if(scheme == :https, do: 443, else: 80)
    path = (if uri.path in [nil, ""], do: "/", else: uri.path) <> if(uri.query, do: "?" <> uri.query, else: "")

    with {:ok, address} <- address(uri.host, Keyword.get(opts, :allow_private, false)) do
      transport =
        [timeout: 10_000, inet6: tuple_size(address) == 8] ++
          if scheme == :https, do: [cacerts: :public_key.cacerts_get()], else: []

      connect(scheme, address, port, uri.host, transport, method, path, headers, body, deadline, max_body)
    end
  end

  defp connect(scheme, address, port, host, transport, method, path, headers, body, deadline, max_body) do
    case Mint.HTTP.connect(scheme, address, port, hostname: host, mode: :passive, protocols: [:http1], transport_opts: transport) do
      {:ok, conn} ->
        result =
          case Mint.HTTP.request(conn, method, path, headers, body) do
            {:ok, conn, ref} -> collect(conn, ref, %{status: nil, headers: [], body: [], size: 0}, deadline, max_body)
            {:error, conn, reason} -> {:error, conn, reason}
          end

        case result do
          {:ok, conn, resp} ->
            Mint.HTTP.close(conn)
            {:ok, %{resp | body: IO.iodata_to_binary(resp.body)}}

          {:error, conn, reason} ->
            Mint.HTTP.close(conn)
            {:error, reason}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp collect(conn, ref, acc, deadline, max_body) do
    case Mint.HTTP.recv(conn, 0, max(deadline - System.monotonic_time(:millisecond), 0)) do
      {:ok, conn, responses} ->
        acc =
          Enum.reduce(responses, acc, fn
            {:status, ^ref, status}, a -> %{a | status: status}
            {:headers, ^ref, headers}, a -> %{a | headers: a.headers ++ headers}
            {:data, ^ref, data}, a -> %{a | body: [a.body | data], size: a.size + byte_size(data)}
            {:done, ^ref}, a -> Map.put(a, :done, true)
            _, a -> a
          end)

        cond do
          acc[:done] -> {:ok, conn, Map.delete(acc, :done) |> Map.delete(:size)}
          acc.size > max_body -> {:error, conn, :too_big}
          true -> collect(conn, ref, acc, deadline, max_body)
        end

      {:error, conn, reason, _} ->
        {:error, conn, reason}
    end
  end

  @doc "A reply header's value, whatever case the server wrote its name in."
  def header(%{headers: headers}, name) do
    Enum.find_value(headers, fn {k, v} -> if String.downcase(k) == name, do: v end)
  end

  @doc """
  Whether a host name points into a private network (the one the server
  sits on, or the machine itself), which the server doesn't reach into
  unless whoever runs it says so.
  """
  def private_host?(host) when is_binary(host) do
    host |> addresses() |> Enum.any?(&private?/1)
  end

  def private_host?(_), do: true

  # The address to connect to: IPv4 first, as most home connections have it.
  defp address(host, allow_private) when is_binary(host) and host != "" do
    case addresses(host) do
      [] ->
        {:error, :nxdomain}

      list ->
        if not allow_private and Enum.any?(list, &private?/1),
          do: {:error, :private},
          else: {:ok, Enum.find(list, hd(list), &(tuple_size(&1) == 4))}
    end
  end

  defp address(_, _), do: {:error, :no_host}

  defp addresses(host) do
    host = String.to_charlist(host)

    for family <- [:inet, :inet6], {:ok, list} <- [:inet.getaddrs(host, family)], address <- list, do: address
  end

  defp private?({10, _, _, _}), do: true
  defp private?({127, _, _, _}), do: true
  defp private?({0, _, _, _}), do: true
  defp private?({169, 254, _, _}), do: true
  defp private?({172, b, _, _}) when b in 16..31, do: true
  defp private?({192, 168, _, _}), do: true
  defp private?({192, 0, 0, _}), do: true
  defp private?({198, b, _, _}) when b in 18..19, do: true
  defp private?({100, b, _, _}) when b in 64..127, do: true
  # Multicast, and the reserved block up to 255.255.255.255.
  defp private?({a, _, _, _}) when a >= 224, do: true
  defp private?({0, 0, 0, 0, 0, 0, 0, a}) when a in [0, 1], do: true
  # IPv4 inside IPv6 (mapped, NAT64 and 6to4) is judged as the IPv4 it holds.
  defp private?({0, 0, 0, 0, 0, 0xFFFF, a, b}), do: private?(v4(a, b))
  defp private?({0x64, 0xFF9B, 0, 0, 0, 0, a, b}), do: private?(v4(a, b))
  defp private?({0x2002, a, b, _, _, _, _, _}), do: private?(v4(a, b))
  defp private?({a, _, _, _, _, _, _, _}) when Bitwise.band(a, 0xFE00) == 0xFC00, do: true
  defp private?({a, _, _, _, _, _, _, _}) when Bitwise.band(a, 0xFFC0) == 0xFE80, do: true
  defp private?({a, _, _, _, _, _, _, _}) when Bitwise.band(a, 0xFF00) == 0xFF00, do: true
  defp private?(_), do: false

  defp v4(a, b), do: {div(a, 256), rem(a, 256), div(b, 256), rem(b, 256)}
end
