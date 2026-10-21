defmodule Family.SetupCode do
  @moduledoc """
  On the internet, whoever opened a fresh Kitchen Table first would become its
  admin. So there, setting up the first admin also takes a setup code:
  SETUP_CODE if it's set, otherwise one made up when it's first needed, kept
  in the data folder's `setup_code` file and written to the log. At home
  (no PHX_HOST) no code is needed.
  """
  require Logger
  alias Family.Accounts.OneTimePassword

  def required?, do: Application.get_env(:family, :setup_code, false) != false

  @doc "The code, made up on first use, or nil when none is needed."
  def current do
    case Application.get_env(:family, :setup_code, false) do
      false -> nil
      code when is_binary(code) -> tidy(code)
      true -> read_or_make()
    end
  end

  def valid?(given) do
    case current() do
      nil -> true
      code -> is_binary(given) and Plug.Crypto.secure_compare(tidy(given), code)
    end
  end

  @doc "Forgets the made-up code once the first admin exists."
  def used, do: File.rm(path())

  defp read_or_make do
    case File.read(path()) do
      {:ok, code} when byte_size(code) > 0 ->
        tidy(code)

      _ ->
        code = OneTimePassword.generate()
        File.write!(path(), code)
        File.chmod(path(), 0o600)
        Logger.warning("Kitchen Table is waiting to be set up. The setup code is #{code}")
        code
    end
  end

  defp path, do: Path.join(Application.fetch_env!(:family, :data_dir), "setup_code")
  defp tidy(code), do: code |> String.trim() |> String.downcase()
end
