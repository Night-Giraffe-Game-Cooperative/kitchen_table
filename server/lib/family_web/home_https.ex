defmodule FamilyWeb.HomeHTTPS do
  @moduledoc """
  A secure address for running at home. Browsers only let a page use the
  camera and microphone over https (or on localhost), so video calls from the
  tablets need it. With `https_port` set, this makes a self-signed certificate
  for this computer's names and addresses, keeps it in the data folder, and
  serves https alongside plain http.

  Each device shows a warning the first time, because nobody vouches for the
  certificate; tapping through it once is enough. On a real server with a
  proper certificate (behind Caddy, say) leave `https_port` unset.
  """

  require Logger
  require Record

  @days 825

  @doc "Adds https to the endpoint's settings when a port is configured."
  def configure do
    with port when is_integer(port) <- Application.get_env(:family, :https_port) do
      dir = Path.join(Application.fetch_env!(:family, :data_dir), "https")
      {certfile, keyfile} = ensure_certificate(dir, names(), addresses())
      endpoint = Application.get_env(:family, FamilyWeb.Endpoint, [])

      https = [ip: {0, 0, 0, 0}, port: port, certfile: certfile, keyfile: keyfile, cipher_suite: :compatible]
      Application.put_env(:family, FamilyWeb.Endpoint, Keyword.put(endpoint, :https, https))
    end

    :ok
  end

  @doc "This computer's IPv4 addresses, other than loopback."
  def addresses do
    case :inet.getifaddrs() do
      {:ok, ifs} ->
        for {_name, opts} <- ifs,
            {:addr, {a, _, _, _} = ip} <- opts,
            a != 127,
            uniq: true,
            do: ip

      _ ->
        []
    end
  end

  defp names do
    {:ok, host} = :inet.gethostname()
    host = to_string(host)
    Enum.uniq(["localhost", host, host <> ".local"])
  end

  @doc """
  Returns the certificate and key files, making them if they're missing, out
  of date, or don't cover every name and address given.
  """
  def ensure_certificate(dir, names, addresses) do
    certfile = Path.join(dir, "cert.pem")
    keyfile = Path.join(dir, "key.pem")
    wanted = Enum.sort(names ++ Enum.map(addresses, &ip_string/1))

    if not covers?(certfile, keyfile, wanted) do
      File.mkdir_p!(dir)
      {cert, key} = certificate_and_key(names, addresses)
      File.write!(certfile, :public_key.pem_encode([{:Certificate, cert, :not_encrypted}]))
      File.write!(keyfile, :public_key.pem_encode([:public_key.pem_entry_encode(:RSAPrivateKey, key)]))
      File.chmod(keyfile, 0o600)
      File.write!(Path.join(dir, "covers.txt"), Enum.join(wanted, "\n"))
      Logger.info("Made a home https certificate for #{Enum.join(wanted, ", ")}")
    end

    {certfile, keyfile}
  end

  defp covers?(certfile, keyfile, wanted) do
    with true <- File.exists?(certfile) and File.exists?(keyfile),
         {:ok, covered} <- File.read(Path.join(Path.dirname(certfile), "covers.txt")),
         true <- Enum.all?(wanted, &(&1 in String.split(covered, "\n"))),
         {:ok, %{mtime: mtime}} <- File.stat(certfile, time: :posix) do
      # Remade a month before it runs out.
      System.os_time(:second) - mtime < (@days - 30) * 86_400
    else
      _ -> false
    end
  end

  defp ip_string(ip), do: ip |> :inet.ntoa() |> to_string()

  ## Building the certificate (after Phoenix's mix phx.gen.cert, with IP addresses)

  Record.defrecordp(:rsa_private_key, :RSAPrivateKey, Record.extract(:RSAPrivateKey, from_lib: "public_key/include/OTP-PUB-KEY.hrl"))
  Record.defrecordp(:rsa_public_key, :RSAPublicKey, Record.extract(:RSAPublicKey, from_lib: "public_key/include/OTP-PUB-KEY.hrl"))
  Record.defrecordp(:otp_tbs_certificate, :OTPTBSCertificate, Record.extract(:OTPTBSCertificate, from_lib: "public_key/include/OTP-PUB-KEY.hrl"))
  Record.defrecordp(:signature_algorithm, :SignatureAlgorithm, Record.extract(:SignatureAlgorithm, from_lib: "public_key/include/OTP-PUB-KEY.hrl"))
  Record.defrecordp(:validity, :Validity, Record.extract(:Validity, from_lib: "public_key/include/OTP-PUB-KEY.hrl"))
  Record.defrecordp(:otp_subject_public_key_info, :OTPSubjectPublicKeyInfo, Record.extract(:OTPSubjectPublicKeyInfo, from_lib: "public_key/include/OTP-PUB-KEY.hrl"))
  Record.defrecordp(:public_key_algorithm, :PublicKeyAlgorithm, Record.extract(:PublicKeyAlgorithm, from_lib: "public_key/include/OTP-PUB-KEY.hrl"))
  Record.defrecordp(:extension, :Extension, Record.extract(:Extension, from_lib: "public_key/include/OTP-PUB-KEY.hrl"))
  Record.defrecordp(:basic_constraints, :BasicConstraints, Record.extract(:BasicConstraints, from_lib: "public_key/include/OTP-PUB-KEY.hrl"))
  Record.defrecordp(:attr, :AttributeTypeAndValue, Record.extract(:AttributeTypeAndValue, from_lib: "public_key/include/OTP-PUB-KEY.hrl"))

  @rsa_encryption {1, 2, 840, 113_549, 1, 1, 1}
  @sha256_with_rsa {1, 2, 840, 113_549, 1, 1, 11}
  @basic_constraints {2, 5, 29, 19}
  @key_usage {2, 5, 29, 15}
  @extended_key_usage {2, 5, 29, 37}
  @subject_key_identifier {2, 5, 29, 14}
  @subject_alt_name {2, 5, 29, 17}
  @organization {2, 5, 4, 10}
  @common_name {2, 5, 4, 3}
  @server_auth {1, 3, 6, 1, 5, 5, 7, 3, 1}

  def certificate_and_key(names, addresses) do
    private_key = :public_key.generate_key({:rsa, 2048, 65_537})
    rsa_private_key(modulus: m, publicExponent: e) = private_key
    public_key = rsa_public_key(modulus: m, publicExponent: e)
    <<serial::unsigned-64>> = :crypto.strong_rand_bytes(8)
    app = Application.get_env(:family, :app_name, "Kitchen Table")

    alt_names =
      Enum.map(names, &{:dNSName, String.to_charlist(&1)}) ++
        Enum.map(addresses, fn {a, b, c, d} -> {:iPAddress, <<a, b, c, d>>} end)

    tbs =
      otp_tbs_certificate(
        version: :v3,
        serialNumber: serial,
        signature: signature_algorithm(algorithm: @sha256_with_rsa),
        issuer: rdn(app),
        validity:
          validity(
            notBefore: {:utcTime, utc_time(Date.add(Date.utc_today(), -1))},
            notAfter: {:utcTime, utc_time(Date.add(Date.utc_today(), @days))}
          ),
        subject: rdn(app),
        subjectPublicKeyInfo:
          otp_subject_public_key_info(
            algorithm: public_key_algorithm(algorithm: @rsa_encryption, parameters: :NULL),
            subjectPublicKey: public_key
          ),
        extensions: [
          extension(extnID: @basic_constraints, critical: true, extnValue: basic_constraints(cA: false)),
          extension(extnID: @key_usage, critical: true, extnValue: [:digitalSignature, :keyEncipherment]),
          extension(extnID: @extended_key_usage, critical: false, extnValue: [@server_auth]),
          extension(
            extnID: @subject_key_identifier,
            critical: false,
            extnValue: :crypto.hash(:sha, :public_key.der_encode(:RSAPublicKey, public_key))
          ),
          extension(extnID: @subject_alt_name, critical: false, extnValue: alt_names)
        ]
      )

    {:public_key.pkix_sign(tbs, private_key), private_key}
  end

  defp utc_time(date), do: ~c"#{date |> Date.to_iso8601(:basic) |> String.slice(2, 6)}000000Z"

  defp rdn(name) do
    {:rdnSequence,
     [
       [attr(type: @organization, value: {:utf8String, name})],
       [attr(type: @common_name, value: {:utf8String, name <> " at home"})]
     ]}
  end
end
