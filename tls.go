package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net"
	"os"
	"time"
)

func generateSelfSignedCert(publicHost string) (tls.Certificate, error) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return tls.Certificate{}, err
	}
	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{Organization: []string{"Local Streamer"}},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	template.IPAddresses = []net.IP{net.ParseIP("127.0.0.1")}
	template.DNSNames = []string{"localhost"}
	if ip := net.ParseIP(publicHost); ip != nil {
		template.IPAddresses = append(template.IPAddresses, ip)
	} else if publicHost != "" {
		template.DNSNames = append(template.DNSNames, publicHost)
	}
	derBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		return tls.Certificate{}, err
	}
	return tls.Certificate{Certificate: [][]byte{derBytes}, PrivateKey: priv}, nil
}

func loadTLSCert(publicHost string) (tls.Certificate, error) {
	if certFile := os.Getenv("TLS_CERT_FILE"); certFile != "" {
		return tls.LoadX509KeyPair(certFile, os.Getenv("TLS_KEY_FILE"))
	}
	return generateSelfSignedCert(publicHost)
}
