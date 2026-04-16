// _core/_ports/outbound/certificate-service-port.js


'use strict';


/** Contract singleton for certificate lookup adapters. */
class CertificateServicePort {
  /**
   * @type {(params: {
   * domain: string,
   * tenantId?: string | null,
   * config?: typeof import('@/config/default.config').adapters.certificateService
   * }) => Promise<null | {
   * domain: string,
   * fullchainPath: string,
   * privkeyPath: string
   * }>}
   */
  getCertificatePathAdapter;

  /** @type {() => Promise<void>} */
  destroyAdapter = async () => { };
}

module.exports = new CertificateServicePort();
Object.preventExtensions(module.exports);
