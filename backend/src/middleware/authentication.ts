const {
  Sep10AuthError,
  Sep10AuthService,
  sep10AuthService,
} = require("../services/Sep10AuthService");

export class Sep10AuthMiddleware {
  private readonly service: InstanceType<typeof Sep10AuthService>;

  constructor(service = sep10AuthService) {
    this.service = service;
    this.issueChallenge = this.issueChallenge.bind(this);
    this.verifyChallenge = this.verifyChallenge.bind(this);
  }

  async issueChallenge(req: any, res: any) {
    try {
      const account =
        req.query?.account ||
        req.body?.account ||
        req.body?.address;

      const challenge = await this.service.createChallenge(account);

      return res.json({
        success: true,
        data: {
          transaction: challenge.transaction,
          challenge: challenge.transaction,
          network_passphrase: challenge.networkPassphrase,
          expiresIn: challenge.expiresIn,
        },
      });
    } catch (error: any) {
      const status = error instanceof Sep10AuthError ? error.status : 500;
      return res.status(status).json({
        success: false,
        error:
          error instanceof Sep10AuthError
            ? error.code
            : "authentication_error",
        message:
          error instanceof Sep10AuthError
            ? error.message
            : "Unable to create SEP-10 challenge",
      });
    }
  }

  async verifyChallenge(req: any, res: any, next: any) {
    try {
      const signedTransaction =
        req.body?.transaction || req.body?.signedChallenge;

      const verified = await this.service.verifyChallenge(signedTransaction);

      req.sep10User = {
        stellarPublicKey: verified.account,
        matchedHomeDomain: verified.matchedHomeDomain,
      };

      return next();
    } catch (error: any) {
      const status = error instanceof Sep10AuthError ? error.status : 500;
      return res.status(status).json({
        success: false,
        error:
          error instanceof Sep10AuthError
            ? error.code
            : "authentication_error",
        message:
          error instanceof Sep10AuthError
            ? error.message
            : "SEP-10 authentication failed",
      });
    }
  }
}

export const sep10AuthMiddleware = new Sep10AuthMiddleware();
