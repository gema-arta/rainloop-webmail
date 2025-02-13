(function () {

	'use strict';

	var
		_ = require('_'),
		ko = require('ko'),
		$ = require('$'),
		kn = require('Knoin/Knoin'),

		Translator = require('Common/Translator'),

		Utils = require('Common/Utils')
	;

	/**
	 * @constructor
	 */
	function PgpUserStore()
	{
		this.capaOpenPGP = ko.observable(false);

		this.openpgp = null;

		this.openpgpkeys = ko.observableArray([]);
		this.openpgpKeyring = null;

		this.openpgpkeysPublic = this.openpgpkeys.filter(function (oItem) {
			return !!(oItem && !oItem.isPrivate);
		});

		this.openpgpkeysPrivate = this.openpgpkeys.filter(function (oItem) {
			return !!(oItem && oItem.isPrivate);
		});
	}

	/**
	 * @return {boolean}
	 */
	PgpUserStore.prototype.isSupported = function ()
	{
		return !!this.openpgp;
	};

	PgpUserStore.prototype.findKeyByHex = function (aKeys,sHash)
	{
		return _.find(aKeys, function (oItem) {
			return sHash && oItem && (sHash === oItem.id || -1 < oItem.ids.indexOf(sHash));
		});
	};

	PgpUserStore.prototype.findPublicKeyByHex = function (sHash)
	{
		return this.findKeyByHex(this.openpgpkeysPublic(), sHash);
	};

	PgpUserStore.prototype.findPrivateKeyByHex = function (sHash)
	{
		return this.findKeyByHex(this.openpgpkeysPrivate(), sHash);
	};

	PgpUserStore.prototype.findPublicKeysByEmail = function (sEmail)
	{
		return _.compact(_.flatten(_.map(this.openpgpkeysPublic(), function (oItem) {
			var oKey = oItem && -1 < oItem.emails.indexOf(sEmail) ? oItem : null;
			return oKey ? oKey.getNativeKeys() : [null];
		}), true));
	};

	PgpUserStore.prototype.findPublicKeysBySigningKeyIds = function (aSigningKeyIds)
	{
		var self = this;
		return _.compact(_.flatten(_.map(aSigningKeyIds, function (oId) {
			var oKey = oId && oId.toHex ? self.findPublicKeyByHex(oId.toHex()) : null;
			return oKey ? oKey.getNativeKeys() : [null];
		}), true));
	};

	PgpUserStore.prototype.findPrivateKeysByEncryptionKeyIds = function (aEncryptionKeyIds, aRecipients, bReturnWrapKeys)
	{
		var self = this, aResult = [];
		aResult = Utils.isArray(aEncryptionKeyIds) ? _.compact(_.flatten(_.map(aEncryptionKeyIds, function (oId) {
			var oKey = oId && oId.toHex ? self.findPrivateKeyByHex(oId.toHex()) : null;
			return oKey ? (bReturnWrapKeys ? [oKey] : oKey.getNativeKeys()) : [null];
		}), true)) : [];

		if (0 === aResult.length && Utils.isNonEmptyArray(aRecipients))
		{
			aResult = _.uniq(_.compact(_.flatten(_.map(aRecipients, function (sEmail) {
				var aKeys = sEmail ? self.findAllPrivateKeysByEmailNotNative(sEmail) : null;
				return aKeys ? (bReturnWrapKeys ? aKeys : _.flatten(_.map(aKeys, function (oKey) { return oKey.getNativeKeys(); }), true)) : [null];
			}), true)), function (oKey) { return oKey.id; });
		}

		return aResult;
	};

	/**
	 * @param {string} sEmail
	 * @return {?}
	 */
	PgpUserStore.prototype.findPublicKeyByEmailNotNative = function (sEmail)
	{
		return _.find(this.openpgpkeysPublic(), function (oItem) {
			return oItem && -1 < oItem.emails.indexOf(sEmail);
		}) || null;
	};

	/**
	 * @param {string} sEmail
	 * @return {?}
	 */
	PgpUserStore.prototype.findPrivateKeyByEmailNotNative = function (sEmail)
	{
		return _.find(this.openpgpkeysPrivate(), function (oItem) {
			return oItem && -1 < oItem.emails.indexOf(sEmail);
		}) || null;
	};

	/**
	 * @param {string} sEmail
	 * @return {?}
	 */
	PgpUserStore.prototype.findAllPublicKeysByEmailNotNative = function (sEmail)
	{
		return _.filter(this.openpgpkeysPublic(), function (oItem) {
			return oItem && -1 < oItem.emails.indexOf(sEmail);
		}) || null;
	};

	/**
	 * @param {string} sEmail
	 * @return {?}
	 */
	PgpUserStore.prototype.findAllPrivateKeysByEmailNotNative = function (sEmail)
	{
		return _.filter(this.openpgpkeysPrivate(), function (oItem) {
			return oItem && -1 < oItem.emails.indexOf(sEmail);
		}) || null;
	};

	/**
	 * @param {string} sEmail
	 * @param {string=} sPassword
	 * @return {?}
	 */
	PgpUserStore.prototype.findPrivateKeyByEmail = function (sEmail, sPassword)
	{
		var
			oPrivateKeys = [],
			oPrivateKey = null,
			oKey = _.find(this.openpgpkeysPrivate(), function (oItem) {
				return oItem && -1 < oItem.emails.indexOf(sEmail);
			})
		;

		if (oKey)
		{
			oPrivateKeys = oKey.getNativeKeys();
			oPrivateKey = oPrivateKeys[0] || null;

			try
			{
				if (oPrivateKey)
				{
					oPrivateKey.decrypt(Utils.pString(sPassword));
				}
			}
			catch (e)
			{
				oPrivateKey = null;
			}
		}

		return oPrivateKey;
	};

	/**
	 * @param {string=} sPassword
	 * @return {?}
	 */
	PgpUserStore.prototype.findSelfPrivateKey = function (sPassword)
	{
		return this.findPrivateKeyByEmail(require('Stores/User/Account').email(), sPassword);
	};

	PgpUserStore.prototype.decryptMessage = function (oMessage, aRecipients, fCallback)
	{
		var self = this, aPrivateKeys = [];
		if (oMessage && oMessage.getEncryptionKeyIds)
		{
			aPrivateKeys = this.findPrivateKeysByEncryptionKeyIds(oMessage.getEncryptionKeyIds(), aRecipients, true);
			if (aPrivateKeys && 0 < aPrivateKeys.length)
			{
				kn.showScreenPopup(require('View/Popup/MessageOpenPgp'), [function (oDecryptedKey) {

					if (oDecryptedKey)
					{
						oMessage.decrypt(oDecryptedKey).then(function(oDecryptedMessage){
							var oPrivateKey = null;
							if (oDecryptedMessage)
							{
								oPrivateKey = self.findPrivateKeyByHex(oDecryptedKey.primaryKey.keyid.toHex());
								if (oPrivateKey)
								{
									self.verifyMessage(oDecryptedMessage, function (oValidKey, aSigningKeyIds) {
										fCallback(oPrivateKey, oDecryptedMessage, oValidKey || null, aSigningKeyIds || null);
									});
								}
								else
								{
									fCallback(oPrivateKey, oDecryptedMessage);
								}
							}
							else
							{
								fCallback(oPrivateKey, oDecryptedMessage);
							}

						}, function() {
							fCallback(null, null);
						});
					}
					else
					{
						fCallback(null, null);
					}

				}, aPrivateKeys]);

				return false;
			}
		}

		fCallback(null, null);

		return false;
	};

	PgpUserStore.prototype.verifyMessage = function (oMessage, fCallback)
	{
		var oValid = null, aResult = [], aPublicKeys = [], aSigningKeyIds = [];
		if (oMessage && oMessage.getSigningKeyIds)
		{
			aSigningKeyIds = oMessage.getSigningKeyIds();
			if (aSigningKeyIds && 0 < aSigningKeyIds.length)
			{
				aPublicKeys = this.findPublicKeysBySigningKeyIds(aSigningKeyIds);
				if (aPublicKeys && 0 < aPublicKeys.length)
				{
					try
					{
						aResult = oMessage.verify(aPublicKeys);
						oValid = _.find(_.isArray(aResult) ? aResult : [], function (oItem) {
							return oItem && oItem.valid && oItem.keyid;
						});

						if (oValid && oValid.keyid && oValid.keyid && oValid.keyid.toHex)
						{
							fCallback(this.findPublicKeyByHex(oValid.keyid.toHex()));
							return true;
						}
					}
					catch (e)
					{
						Utils.log(e);
					}
				}

				fCallback(null, aSigningKeyIds);
				return false;
			}
		}

		fCallback(null);
		return false;
	};

	/**
	 * @param {*} mDom
	 */
	PgpUserStore.prototype.controlsHelper = function (mDom, oVerControl, bSuccess, sTitle, sText)
	{
		if (bSuccess)
		{
			mDom.removeClass('error').addClass('success').attr('title', sTitle);
			oVerControl.removeClass('error').addClass('success').attr('title', sTitle);
		}
		else
		{
			mDom.removeClass('success').addClass('error').attr('title', sTitle);
			oVerControl.removeClass('success').addClass('error').attr('title', sTitle);
		}

		if (!Utils.isUnd(sText))
		{
			mDom.text(Utils.trim(sText.replace(/(\u200C|\u0002)/g, '')));
		}
	};

	/**
	 * @static
	 */
	PgpUserStore.domControlEncryptedClickHelper = function (self, mDom, sArmoredMessage, aRecipients)
	{
		return function () {

			var oMessage = null, $this = $(this);
			if ($this.hasClass('success'))
			{
				return false;
			}

			try
			{
				oMessage = self.openpgp.message.readArmored(sArmoredMessage);
			}
			catch (e)
			{
				Utils.log(e);
			}

			if (oMessage && oMessage.getText && oMessage.verify && oMessage.decrypt)
			{
				self.decryptMessage(oMessage, aRecipients, function (oValidPrivateKey, oDecryptedMessage, oValidPublicKey, aSigningKeyIds) {

					if (oDecryptedMessage)
					{
						if (oValidPublicKey)
						{
							self.controlsHelper(mDom, $this, true, Translator.i18n('PGP_NOTIFICATIONS/GOOD_SIGNATURE', {
								'USER': oValidPublicKey.user + ' (' + oValidPublicKey.id + ')'
							}), oDecryptedMessage.getText());
						}
						else if (oValidPrivateKey)
						{
							var
								aKeyIds = Utils.isNonEmptyArray(aSigningKeyIds) ? aSigningKeyIds : null,
								sAdditional = aKeyIds ? _.compact(_.map(aKeyIds, function (oItem) {
									return oItem && oItem.toHex ? oItem.toHex() : null;
								})).join(', ') : ''
							;

							self.controlsHelper(mDom, $this, false,
								Translator.i18n('PGP_NOTIFICATIONS/UNVERIFIRED_SIGNATURE') +
									(sAdditional ? ' (' + sAdditional + ')' : ''),
									oDecryptedMessage.getText());
						}
						else
						{
							self.controlsHelper(mDom, $this, false,
								Translator.i18n('PGP_NOTIFICATIONS/DECRYPTION_ERROR'));
						}
					}
					else
					{
						self.controlsHelper(mDom, $this, false,
							Translator.i18n('PGP_NOTIFICATIONS/DECRYPTION_ERROR'));
					}
				});

				return false;
			}

			self.controlsHelper(mDom, $this, false, Translator.i18n('PGP_NOTIFICATIONS/DECRYPTION_ERROR'));
			return false;
		};
	};

	/**
	 * @static
	 */
	PgpUserStore.domControlSignedClickHelper = function (self, mDom, sArmoredMessage)
	{
		return function () {

			var oMessage = null, $this = $(this);
			if ($this.hasClass('success') || $this.hasClass('error'))
			{
				return false;
			}

			try
			{
				oMessage = self.openpgp.cleartext.readArmored(sArmoredMessage);
			}
			catch (e)
			{
				Utils.log(e);
			}

			if (oMessage && oMessage.getText && oMessage.verify)
			{
				self.verifyMessage(oMessage, function (oValidKey, aSigningKeyIds) {
					if (oValidKey)
					{
						self.controlsHelper(mDom, $this, true, Translator.i18n('PGP_NOTIFICATIONS/GOOD_SIGNATURE', {
							'USER': oValidKey.user + ' (' + oValidKey.id + ')'
						}), oMessage.getText());
					}
					else
					{
						var
							aKeyIds = Utils.isNonEmptyArray(aSigningKeyIds) ? aSigningKeyIds : null,
							sAdditional = aKeyIds ? _.compact(_.map(aKeyIds, function (oItem) {
								return oItem && oItem.toHex ? oItem.toHex() : null;
							})).join(', ') : ''
						;

						self.controlsHelper(mDom, $this, false,
							Translator.i18n('PGP_NOTIFICATIONS/UNVERIFIRED_SIGNATURE') +
								(sAdditional ? ' (' + sAdditional + ')' : ''));
					}
				});

				return false;
			}

			self.controlsHelper(mDom, $this, false, Translator.i18n('PGP_NOTIFICATIONS/DECRYPTION_ERROR'));
			return false;
		};
	};

	/**
	 * @param {*} mDom
	 * @param {MessageModel} oRainLoopMessage
	 */
	PgpUserStore.prototype.initMessageBodyControls = function (mDom, oRainLoopMessage)
	{
		if (mDom && !mDom.hasClass('inited'))
		{
			mDom.addClass('inited');

			var
				bEncrypted = mDom.hasClass('encrypted'),
				bSigned = mDom.hasClass('signed'),
				oVerControl = null,
				aRecipients = oRainLoopMessage ? oRainLoopMessage.getEmails(['from', 'to', 'cc']) : [],
				sData = ''
			;

			if (bEncrypted || bSigned)
			{
				sData = mDom.text();
				mDom.data('openpgp-original', sData);

				if (bEncrypted)
				{
					oVerControl = $('<div class="b-openpgp-control"><i class="icon-lock"></i></div>')
						.attr('title', Translator.i18n('MESSAGE/PGP_ENCRYPTED_MESSAGE_DESC'))
						.on('click', PgpUserStore.domControlEncryptedClickHelper(this, mDom, sData, aRecipients))
					;
				}
				else if (bSigned)
				{
					oVerControl = $('<div class="b-openpgp-control"><i class="icon-lock"></i></div>')
						.attr('title', Translator.i18n('MESSAGE/PGP_SIGNED_MESSAGE_DESC'))
						.on('click', PgpUserStore.domControlSignedClickHelper(this, mDom, sData))
					;
				}

				if (oVerControl)
				{
					mDom.before(oVerControl).before('<div></div>');
				}
			}
		}
	};

	module.exports = new PgpUserStore();

}());

