/**
 * Xbox Live REST API helper for Minecraft Bedrock bot integration.
 * Handles Profile, Presence, Social/Friends, and Multiplayer Session Directory (MPSD).
 */

const crypto = require('crypto');

class XboxLiveApi {
  /**
   * Helper to perform authenticated Xbox Live API calls
   */
  static async request(url, { userHash, xstsToken, method = 'GET', body = null, contractVersion = '1' }) {
    const headers = {
      'Authorization': `XBL3.0 x=${userHash};${xstsToken}`,
      'Accept': 'application/json',
      'x-xbl-contract-version': String(contractVersion),
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const options = {
      method,
      headers,
    };

    if (body) {
      options.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const res = await fetch(url, options);

    if (res.status === 204) {
      return { success: true };
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = text;
    }

    if (!res.ok) {
      const msg = (data && (data.description || data.message || data.error)) || `Xbox Live API error HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  /**
   * Fetch Gamertag, Avatar, and Gamerscore via Xbox Live Profile Batch API
   */
  static async getProfile({ userHash, xstsToken, xuid }) {
    try {
      const url = 'https://profile.xboxlive.com/users/batch/profile/settings';
      const body = {
        userIds: [String(xuid)],
        settings: ['Gamertag', 'GameDisplayName', 'AppDisplayName', 'GameDisplayPicRaw', 'Gamerscore'],
      };

      const data = await this.request(url, {
        userHash,
        xstsToken,
        method: 'POST',
        body,
        contractVersion: '2',
      });
      
      const settings = (data.profileUsers && data.profileUsers[0] && data.profileUsers[0].settings) || [];
      const getVal = (id) => {
        const found = settings.find(s => s.id === id);
        return found ? found.value : null;
      };

      const gamertag = getVal('Gamertag') || getVal('GameDisplayName') || getVal('AppDisplayName') || 'Xbox User';
      const displayPic = getVal('GameDisplayPicRaw') || 'https://images.placeholders.dev/?width=100&height=100&text=Xbox';
      const gamerscore = getVal('Gamerscore') || '0';

      return {
        gamertag,
        displayPic,
        gamerscore,
        xuid,
      };
    } catch (err) {
      console.warn('[XboxLiveApi] Failed to fetch full profile settings:', err.message);
      return {
        gamertag: 'The FatGoats595',
        displayPic: '',
        gamerscore: '0',
        xuid,
      };
    }
  }

  /**
   * Set user presence as actively playing Minecraft Bedrock
   */
  static async setPresence({ userHash, xstsToken, xuid, state = 'Active' }) {
    try {
      const url = `https://userpresence.xboxlive.com/users/xuid(${xuid})/devices/current/titles/current`;
      // Minecraft Bedrock titleId on Xbox Live: 896928775
      const body = {
        state,
        titleId: '896928775',
      };
      await this.request(url, {
        userHash,
        xstsToken,
        method: 'POST',
        body,
        contractVersion: '1',
      });
      return true;
    } catch (err) {
      console.warn('[XboxLiveApi] Could not set presence:', err.message);
      return false;
    }
  }

  /**
   * Publish a Minecraft Bedrock multiplayer lobby session (MPSD)
   * This broadcasts the session so friends see the bot hosting in Minecraft Friends tab!
   */
  static async publishMultiplayerSession({ userHash, xstsToken, xuid, sessionName, serverAddress, serverPort, worldName = 'Dedicated Realm' }) {
    try {
      const scid = '4fc10100-5f7a-4470-899b-280835760c07'; // Minecraft Bedrock SCID
      const url = `https://sessiondirectory.xboxlive.com/serviceconfigs/${scid}/sessiontemplates/MinecraftLobby/sessions/${sessionName}`;
      const connectionId = crypto.randomUUID();

      const payload = {
        properties: {
          system: {
            joinRestriction: 'followed',
            closed: false,
          },
          custom: {
            Joinability: 'joinable_by_friends',
            serverAddress: String(serverAddress),
            serverPort: Number(serverPort),
            worldName: String(worldName),
            version: '1.26',
            broadcast: true,
          },
        },
        members: {
          me: {
            constants: {
              system: {
                xuid,
                initialize: true,
              },
            },
            properties: {
              system: {
                active: true,
                connection: connectionId,
              },
            },
          },
        },
      };

      const result = await this.request(url, {
        userHash,
        xstsToken,
        method: 'PUT',
        body: payload,
        contractVersion: '107',
      });

      return { success: true, result };
    } catch (err) {
      console.warn('[XboxLiveApi] Session directory publish error:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Delete an active multiplayer session when the bot stops
   */
  static async deleteMultiplayerSession({ userHash, xstsToken, sessionName }) {
    try {
      const scid = '4fc10100-5f7a-4470-899b-280835760c07';
      const url = `https://sessiondirectory.xboxlive.com/serviceconfigs/${scid}/sessiontemplates/MinecraftLobby/sessions/${sessionName}`;
      await this.request(url, {
        userHash,
        xstsToken,
        method: 'DELETE',
        contractVersion: '107',
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Get people / followers from Xbox Live PeopleHub
   */
  static async getPeople({ userHash, xstsToken }) {
    try {
      const url = 'https://peoplehub.xboxlive.com/users/me/people/social/decoration/broadcast,multiplayer';
      const data = await this.request(url, { userHash, xstsToken, contractVersion: '1' });
      return (data && data.people) || [];
    } catch (err) {
      try {
        // Fallback to social.xboxlive.com endpoint
        const fallbackUrl = 'https://social.xboxlive.com/users/me/people';
        const fbData = await this.request(fallbackUrl, { userHash, xstsToken, contractVersion: '1' });
        return (fbData && fbData.people) || [];
      } catch (err2) {
        console.warn('[XboxLiveApi] Error fetching people:', err2.message);
        return [];
      }
    }
  }

  /**
   * Add a user as friend (accept their follow request)
   */
  static async addFriend({ userHash, xstsToken, userXuid, targetXuid }) {
    try {
      const url = `https://social.xboxlive.com/users/xuid(${userXuid})/people/xuid(${targetXuid})`;
      await this.request(url, {
        userHash,
        xstsToken,
        method: 'PUT',
        contractVersion: '1',
      });
      return true;
    } catch (err) {
      console.warn(`[XboxLiveApi] Failed to add friend ${targetXuid}:`, err.message);
      return false;
    }
  }
}

module.exports = XboxLiveApi;
