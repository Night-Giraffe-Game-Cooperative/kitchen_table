defmodule Family.FakeSMTP do
  @moduledoc """
  An email server for tests. Each email goes to the process registered as
  :fake_smtp (the test), and the password "wrong" is turned away as Gmail
  turns away a bad app password.
  """

  def send(opts, to, subject, body) do
    if pid = Process.whereis(:fake_smtp), do: Kernel.send(pid, {:email, opts, to, subject, body})

    if opts[:password] == "wrong",
      do: {:error, "535 5.7.8 Username and Password not accepted"},
      else: :ok
  end
end
