FROM node:18

# Install Git
RUN apt-get update && apt-get install -y git

# Set work directory
WORKDIR /app

# Copy files
COPY . .

# Install dependencies
RUN npm install

# Expose port
EXPOSE 8080

# Start your app
CMD ["npm", "start"]
