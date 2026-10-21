defmodule Family.HTTPTest do
  use ExUnit.Case, async: true
  alias Family.HTTP

  test "private addresses are refused unless allowed, and checked before connecting" do
    nowhere = URI.parse("http://127.0.0.1:9/")
    assert {:error, :private} = HTTP.request("GET", nowhere, [], nil)
    assert {:error, :private} = HTTP.request("GET", URI.parse("http://localhost:9/"), [], nil)
    assert {:error, :private} = HTTP.request("GET", URI.parse("http://[::ffff:10.0.0.1]:9/"), [], nil)
    assert {:error, :no_host} = HTTP.request("GET", URI.parse("http:///calendar"), [], nil)

    # Allowed, it really tries (and nothing is listening there).
    assert {:error, reason} = HTTP.request("GET", nowhere, [], nil, allow_private: true)
    refute reason == :private
  end

  test "which addresses count as private" do
    for host <- ~w(10.1.2.3 172.16.0.1 192.168.1.1 169.254.169.254 100.64.0.1 0.0.0.0 224.0.0.1 198.18.0.1 ::1 fd00::1 fe80::1 ff02::1 64:ff9b::a00:1 2002:c0a8:101::1) do
      assert HTTP.private_host?(host), host
    end

    for host <- ~w(1.1.1.1 8.8.8.8 2606:4700:4700::1111 64:ff9b::808:808) do
      refute HTTP.private_host?(host), host
    end

    assert HTTP.private_host?(nil)
  end
end
